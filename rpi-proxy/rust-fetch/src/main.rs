use anyhow::{Context, Result, bail};
use reqwest::{header, Client};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::time::Duration;

mod animekai;
mod animekai_tables;

// ─── reCAPTCHA v3 HTTP-only bypass ─────────────────────
// Replicates the api2/anchor → api2/reload flow used by PyPasser,
// go-recaptcha-v3-bypass, and s0ftik3/recaptcha-bypass.
// No browser needed — pure HTTP with Chrome TLS fingerprint.

mod recaptcha_v3 {
    use anyhow::{Context, Result, bail};
    use reqwest::Client;

    /// Extract the reCAPTCHA JS version string from the API JS loader
    async fn get_recaptcha_version(client: &Client) -> Result<String> {
        let js_url = "https://www.google.com/recaptcha/api.js?render=explicit";
        let body = client.get(js_url)
            .header("Referer", "https://adffdafdsafds.sbs/")
            .send().await.context("fetch recaptcha api.js")?
            .text().await.context("read api.js body")?;
        
        // Look for releases/VERSION or v=VERSION pattern
        // e.g. "https://www.gstatic.com/recaptcha/releases/u-xcq3POCWFlCr3x8_IPxgPu/recaptcha__en.js"
        if let Some(start) = body.find("releases/") {
            let rest = &body[start + 9..];
            if let Some(end) = rest.find('/') {
                let version = &rest[..end];
                if !version.is_empty() && version.len() < 60 {
                    return Ok(version.to_string());
                }
            }
        }
        
        // Fallback: try fetching the enterprise loader
        let enterprise_url = "https://www.google.com/recaptcha/enterprise.js?render=explicit";
        let body2 = client.get(enterprise_url)
            .header("Referer", "https://adffdafdsafds.sbs/")
            .send().await.unwrap_or_else(|_| panic!("enterprise fetch"))
            .text().await.unwrap_or_default();
        
        if let Some(start) = body2.find("releases/") {
            let rest = &body2[start + 9..];
            if let Some(end) = rest.find('/') {
                let version = &rest[..end];
                if !version.is_empty() && version.len() < 60 {
                    return Ok(version.to_string());
                }
            }
        }
        
        bail!("could not extract reCAPTCHA version from api.js")
    }

    /// Get reCAPTCHA v3 token via HTTP-only anchor/reload flow
    pub async fn solve(
        client: &Client,
        site_key: &str,
        page_url: &str,
        action: &str,
    ) -> Result<String> {
        // 1. Extract version
        let version = get_recaptcha_version(client).await?;
        eprintln!("[recaptcha-v3] version={}", version);

        // 2. Build co param (base64 of origin with port)
        let parsed = url::Url::parse(page_url).context("bad page URL")?;
        let origin_with_port = format!("{}://{}:{}",
            parsed.scheme(),
            parsed.host_str().unwrap_or(""),
            if parsed.scheme() == "https" { 443 } else { 80 }
        );
        let co = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            origin_with_port.as_bytes(),
        );
        // reCAPTCHA uses URL-safe base64 with trailing dot
        let co = format!("{}.", co.trim_end_matches('='));
        eprintln!("[recaptcha-v3] co={}", co);

        // 3. Random callback
        let cb = format!("cb{}", rand::random::<u32>() % 999999);

        // 4. GET anchor page
        let anchor_url = format!(
            "https://www.google.com/recaptcha/api2/anchor?ar=1&k={}&co={}&hl=en&v={}&size=invisible&cb={}",
            site_key, co, version, cb
        );
        eprintln!("[recaptcha-v3] anchor GET: {}", &anchor_url[..anchor_url.len().min(120)]);

        let anchor_resp = client.get(&anchor_url)
            .header("Referer", page_url)
            .send().await.context("anchor request failed")?;
        
        let anchor_html = anchor_resp.text().await.context("read anchor body")?;
        eprintln!("[recaptcha-v3] anchor HTML: {} bytes", anchor_html.len());

        // 5. Parse recaptcha-token from anchor HTML
        // Pattern: <input ... id="recaptcha-token" ... value="TOKEN">
        let token = extract_input_value(&anchor_html, "recaptcha-token")
            .context("could not find recaptcha-token in anchor page")?;
        eprintln!("[recaptcha-v3] anchor token: {}...{}", &token[..token.len().min(20)], &token[token.len().saturating_sub(10)..]);

        // 6. POST reload
        let reload_url = format!(
            "https://www.google.com/recaptcha/api2/reload?k={}",
            site_key
        );
        
        let form_params = [
            ("v", version.as_str()),
            ("reason", "q"),
            ("c", token.as_str()),
            ("k", site_key),
            ("co", co.as_str()),
            ("hl", "en"),
            ("size", "invisible"),
            ("chr", "%5B89%2C64%2C27%5D"),
            ("vh", "13599012192"),
            ("bg", ""),
            ("sa", action),
        ];
        
        eprintln!("[recaptcha-v3] reload POST: {}", reload_url);

        let reload_resp = client.post(&reload_url)
            .header("Referer", &anchor_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&form_params)
            .send().await.context("reload request failed")?;

        let reload_body = reload_resp.text().await.context("read reload body")?;
        eprintln!("[recaptcha-v3] reload response: {} bytes", reload_body.len());

        // 7. Parse rresp token from reload response
        // Format: )]}\n["rresp","TOKEN_HERE",null,120]
        let final_token = extract_rresp(&reload_body)
            .context("could not parse rresp from reload response")?;
        
        eprintln!("[recaptcha-v3] ✅ got token: {}...{} ({}b)", 
            &final_token[..final_token.len().min(20)],
            &final_token[final_token.len().saturating_sub(10)..],
            final_token.len()
        );

        Ok(final_token)
    }

    /// Extract value from <input ... id="ID" ... value="VALUE">
    fn extract_input_value(html: &str, id: &str) -> Option<String> {
        // Find the input with this id
        let id_pattern = format!(r#"id="{}""#, id);
        let pos = html.find(&id_pattern)?;
        
        // Search for value= in the surrounding tag
        // Look backwards for '<' to find tag start
        let tag_start = html[..pos].rfind('<')?;
        // Look forwards for '>' to find tag end
        let tag_end = html[pos..].find('>')? + pos;
        let tag = &html[tag_start..=tag_end];
        
        // Extract value="..."
        let val_start = tag.find(r#"value=""#)? + 7;
        let val_end = tag[val_start..].find('"')? + val_start;
        Some(tag[val_start..val_end].to_string())
    }

    /// Extract token from rresp response: )]\}\n["rresp","TOKEN",...]
    fn extract_rresp(body: &str) -> Option<String> {
        // Try pattern: ["rresp","TOKEN"
        if let Some(start) = body.find(r#"["rresp",""#) {
            let rest = &body[start + 10..];
            if let Some(end) = rest.find('"') {
                let token = &rest[..end];
                if token.len() > 20 {
                    return Some(token.to_string());
                }
            }
        }
        
        // Fallback: try uvresp
        if let Some(start) = body.find(r#"["uvresp",""#) {
            let rest = &body[start + 11..];
            if let Some(end) = rest.find('"') {
                let token = &rest[..end];
                if token.len() > 20 {
                    return Some(token.to_string());
                }
            }
        }
        
        None
    }
}

// ─── Mode: recaptcha-v3 ────────────────────────────────
// HTTP-only reCAPTCHA v3 token generation.
// Input: --url <page_url> --site-key <key> --action <action>
// Output: reCAPTCHA token to stdout

async fn mode_recaptcha_v3(
    client: &Client,
    page_url: &str,
    site_key: &str,
    action: &str,
) -> Result<()> {
    let token = recaptcha_v3::solve(client, site_key, page_url, action).await?;
    print!("{}", token);
    Ok(())
}

// ─── HTTP Client ────────────────────────────────────────

fn build_client(
    timeout: Duration,
    follow_redirects: bool,
    custom_headers: &HashMap<String, String>,
) -> Result<Client> {
    let mut headers = header::HeaderMap::new();
    headers.insert(header::USER_AGENT, header::HeaderValue::from_static(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    ));
    headers.insert(header::ACCEPT, header::HeaderValue::from_static("*/*"));
    headers.insert(header::ACCEPT_LANGUAGE, header::HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(header::ACCEPT_ENCODING, header::HeaderValue::from_static("gzip, deflate, br"));

    for (k, v) in custom_headers {
        let name = header::HeaderName::from_bytes(k.as_bytes())
            .context(format!("bad header: {k}"))?;
        let val = header::HeaderValue::from_str(v)
            .context(format!("bad value: {k}={v}"))?;
        headers.insert(name, val);
    }

    Client::builder()
        .timeout(timeout)
        .redirect(if follow_redirects {
            reqwest::redirect::Policy::limited(10)
        } else {
            reqwest::redirect::Policy::none()
        })
        .default_headers(headers)
        .cookie_store(true)
        .gzip(true)
        .brotli(true)
        .build()
        .context("client build failed")
}

async fn fetch_text(client: &Client, url: &str) -> Result<String> {
    let resp = client.get(url).send().await.context("request failed")?;
    let status = resp.status();
    eprintln!("[{}] {}", status.as_u16(), url);
    let body = resp.text().await.context("read body failed")?;
    if !status.is_success() {
        bail!("HTTP {}: {}", status.as_u16(), &body[..body.len().min(200)]);
    }
    Ok(body)
}

// (post_json removed — no external API dependencies)

// (post_json removed — no external API dependencies)

// ─── MegaCloud Decryption (ported from aniwatch JS) ─────

mod megacloud {
    use anyhow::{Result, bail};

    fn keygen(megacloud_key: &str, client_key: &str) -> String {
        let temp_key_str = format!("{}{}", megacloud_key, client_key);
        let mut hash: i128 = 0;
        for ch in temp_key_str.bytes() {
            hash = (ch as i128) + hash.wrapping_mul(31) + (hash << 7) - hash;
        }
        if hash < 0 { hash = -hash; }
        let l_hash = (hash % 0x7fffffffffffffffi128) as usize;

        let mut temp: Vec<u8> = temp_key_str.bytes().map(|b| b ^ 247).collect();

        let pivot = (l_hash % temp.len()) + 5;
        let mut rotated = temp[pivot..].to_vec();
        rotated.extend_from_slice(&temp[..pivot]);
        temp = rotated;

        let leaf: Vec<u8> = client_key.bytes().rev().collect();
        let mut ret = Vec::new();
        let max_len = temp.len().max(leaf.len());
        for i in 0..max_len {
            if i < temp.len() { ret.push(temp[i]); }
            if i < leaf.len() { ret.push(leaf[i]); }
        }
        ret.truncate(96 + (l_hash % 33));
        ret.iter().map(|&b| ((b as u32 % 95) + 32) as u8 as char).collect()
    }

    fn seed_shuffle(char_array: &[u8], key: &str) -> Vec<u8> {
        let mut hash: u64 = 0;
        for ch in key.bytes() {
            hash = (hash.wrapping_mul(31).wrapping_add(ch as u64)) & 0xffffffff;
        }
        let mut seed = hash;
        let pseudo_rand = |seed: &mut u64, arg: usize| -> usize {
            *seed = ((*seed).wrapping_mul(1103515245).wrapping_add(12345)) & 0x7fffffff;
            (*seed as usize) % arg
        };
        let mut arr = char_array.to_vec();
        for i in (1..arr.len()).rev() {
            let j = pseudo_rand(&mut seed, i + 1);
            arr.swap(i, j);
        }
        arr
    }

    fn columnar_decipher(src: &str, key: &str) -> String {
        let col_count = key.len();
        let row_count = (src.len() + col_count - 1) / col_count;
        let mut grid = vec![vec![b' '; col_count]; row_count];

        let mut key_map: Vec<(u8, usize)> = key.bytes().enumerate().map(|(i, b)| (b, i)).collect();
        key_map.sort_by_key(|&(b, _)| b);

        let src_bytes: Vec<u8> = src.bytes().collect();
        let mut idx = 0;
        for &(_, col) in &key_map {
            for row in 0..row_count {
                if idx < src_bytes.len() {
                    grid[row][col] = src_bytes[idx];
                    idx += 1;
                }
            }
        }

        let mut out = Vec::with_capacity(src.len());
        for row in &grid {
            out.extend_from_slice(row);
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    pub fn decrypt_src(src: &str, client_key: &str, megacloud_key: &str) -> Result<String> {
        use base64::Engine;
        let gen_key = keygen(megacloud_key, client_key);
        let decoded = base64::engine::general_purpose::STANDARD.decode(src)
            .map_err(|e| anyhow::anyhow!("base64 decode: {e}"))?;
        let mut dec_src = String::from_utf8_lossy(&decoded).into_owned();

        let char_array: Vec<u8> = (32u8..127).collect(); // 95 printable ASCII

        for iteration in (1..=3).rev() {
            let layer_key = format!("{}{}", gen_key, iteration);
            let mut hash: u64 = 0;
            for ch in layer_key.bytes() {
                hash = (hash.wrapping_mul(31).wrapping_add(ch as u64)) & 0xffffffff;
            }
            let mut seed = hash;
            let pseudo_rand = |seed: &mut u64, arg: usize| -> usize {
                *seed = ((*seed).wrapping_mul(1103515245).wrapping_add(12345)) & 0x7fffffff;
                (*seed as usize) % arg
            };

            // Reverse substitution
            let sub_values = seed_shuffle(&char_array, &layer_key);
            let mut char_map = [0u8; 128];
            for (i, &sv) in sub_values.iter().enumerate() {
                if (sv as usize) < 128 {
                    char_map[sv as usize] = char_array[i];
                }
            }
            dec_src = dec_src.bytes().map(|b| {
                if b >= 32 && b < 127 { char_map[b as usize] as char } else { b as char }
            }).collect();

            // Reverse columnar cipher
            dec_src = columnar_decipher(&dec_src, &layer_key);

            // Reverse character shift
            seed = hash; // reset seed
            dec_src = dec_src.bytes().map(|b| {
                let idx = char_array.iter().position(|&c| c == b);
                match idx {
                    Some(ci) => {
                        let rand = pseudo_rand(&mut seed, 95);
                        let new_idx = (ci + rand) % 95;
                        char_array[new_idx] as char
                    }
                    None => b as char,
                }
            }).collect();
        }

        // Extract data length prefix
        let data_len: usize = dec_src[..4].parse()
            .map_err(|_| anyhow::anyhow!("bad length prefix: {}", &dec_src[..4.min(dec_src.len())]))?;
        if data_len + 4 > dec_src.len() {
            bail!("data_len {} exceeds decrypted size {}", data_len, dec_src.len());
        }
        Ok(dec_src[4..4 + data_len].to_string())
    }
}

// ─── MegaCloud client key extraction ────────────────────

fn extract_client_key(html: &str) -> Result<String> {
    // Pattern 1: <meta name="_gg_fb" content="KEY">
    if let Some(cap) = find_between(html, r#"<meta name="_gg_fb" content=""#, r#"">"#) {
        return Ok(cap);
    }
    // Pattern 2: <!-- _is_th:KEY -->
    if let Some(cap) = find_between(html, "<!-- _is_th:", " -->") {
        return Ok(cap.trim().to_string());
    }
    // Pattern 3: window._lk_db = {x: "A", y: "B", z: "C"};
    if let Some(block) = find_between(html, "window._lk_db", "};") {
        let mut key = String::new();
        for label in ["x:", "y:", "z:"] {
            if let Some(start) = block.find(label) {
                let rest = &block[start + label.len()..];
                if let Some(v) = find_between(rest, "\"", "\"") {
                    key.push_str(&v);
                }
            }
        }
        if !key.is_empty() { return Ok(key); }
    }
    // Pattern 4: <div data-dpi="KEY" ...>
    if let Some(cap) = find_between(html, r#"data-dpi=""#, r#"""#) {
        return Ok(cap);
    }
    // Pattern 5: <script nonce="KEY">
    if let Some(cap) = find_between(html, r#"<script nonce=""#, r#"">"#) {
        return Ok(cap);
    }
    // Pattern 6: window._xy_ws = "KEY";
    if let Some(cap) = find_between(html, r#"window._xy_ws = ""#, r#"";"#) {
        return Ok(cap);
    }
    if let Some(cap) = find_between(html, r#"window._xy_ws = '"#, r#"';"#) {
        return Ok(cap);
    }
    bail!("could not extract client key from embed page")
}

fn find_between(haystack: &str, start: &str, end: &str) -> Option<String> {
    let s = haystack.find(start)? + start.len();
    let e = haystack[s..].find(end)? + s;
    Some(haystack[s..e].to_string())
}

// ─── MegaCloud key from GitHub ──────────────────────────

async fn fetch_megacloud_key(client: &Client) -> Result<String> {
    let urls = [
        "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json",
        "https://raw.githubusercontent.com/CattoFish/MegacloudKeys/refs/heads/main/keys.json",
        "https://raw.githubusercontent.com/ghoshRitesh12/aniwatch/refs/heads/main/src/extractors/megacloud-keys.json",
    ];
    for url in urls {
        if let Ok(body) = fetch_text(client, url).await {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                let key = v.get("mega").or(v.get("key"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(k) = key {
                    if !k.is_empty() { return Ok(k); }
                }
            }
        }
    }
    bail!("failed to fetch megacloud key from all sources")
}

// ─── Mode: megacloud ────────────────────────────────────
// Input: MegaCloud embed URL (e.g. https://megacloud.blog/embed-2/v3/e-1/XXXXX?k=1)
// Output: JSON { sources: [...], tracks: [...], intro: {...}, outro: {...} }

async fn mode_megacloud(client: &Client, embed_url: &str) -> Result<()> {
    let source_id = embed_url.split('/').last()
        .and_then(|s| s.split('?').next())
        .context("bad embed URL")?;
    eprintln!("[megacloud] sourceId={}", source_id);

    // 1. Fetch embed page → extract client key
    let embed_html = fetch_text(client, embed_url).await?;
    let client_key = extract_client_key(&embed_html)?;
    eprintln!("[megacloud] clientKey={}", client_key);

    // 2. Fetch megacloud decryption key from GitHub
    let mc_key = fetch_megacloud_key(client).await?;
    eprintln!("[megacloud] mcKey={}...", &mc_key[..mc_key.len().min(20)]);

    // 3. Call getSources API
    let src_url = format!(
        "https://megacloud.blog/embed-2/v3/e-1/getSources?id={}&_k={}",
        source_id, client_key
    );
    let src_body = fetch_text(client, &src_url).await?;
    let src_data: Value = serde_json::from_str(&src_body).context("getSources JSON")?;

    let encrypted = src_data.get("encrypted").and_then(|v| v.as_bool()).unwrap_or(false);

    // 4. Decrypt sources if encrypted
    let sources: Value = if encrypted {
        let enc_str = src_data.get("sources").and_then(|v| v.as_str())
            .context("encrypted sources not a string")?;
        eprintln!("[megacloud] decrypting {} chars...", enc_str.len());
        let decrypted = megacloud::decrypt_src(enc_str, &client_key, &mc_key)?;
        serde_json::from_str(&decrypted).context("decrypted JSON parse")?
    } else {
        src_data.get("sources").cloned().unwrap_or(Value::Array(vec![]))
    };

    // 5. Build output
    let output = serde_json::json!({
        "sources": sources,
        "tracks": src_data.get("tracks").cloned().unwrap_or(Value::Array(vec![])),
        "intro": src_data.get("intro").cloned().unwrap_or(Value::Null),
        "outro": src_data.get("outro").cloned().unwrap_or(Value::Null),
    });
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

// ─── MegaUp Native Decryption ───────────────────────────
// XOR stream cipher with pre-computed keystream (UA-dependent).
// Eliminates enc-dec.app dependency entirely.

mod megaup {
    use anyhow::{Result, bail};
    use base64::Engine;

    // Pre-computed keystream for fixed UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    const KEYSTREAM_HEX: &str = "cd04e9c92863097ef5e0b5010d2d7bb7ff8e3efd831d83da12a45a1aca29d1953c552272fdb39a789049975aa97586781074b4a13d841e7945e2f0c5b632b4202dc8979699db15aacdc53193784eb52278fb7c0c33e2b3073bb1c2d6b86e9aa17a8c4d58e44d2b6035e2966ead4047bbe68392924ede09de62294c29b998568eaf420dd8a84a476d0e5ebd76ec8d83dfc186903afc109a855dc05da1d1c57084e8316191571538ecdd51be555c4e245bc38068ac8054af44089db6fc10470a7bca7d276045b11caeac973263324e86fcf8d79f8415c33fce7b53e0dfcba2ec8157ab8504c03a9687fd57909cc78aeef452b06f54c2d6d990390ed49ddc605a9fecc1509619342f70884a399a51097388f58d2668f1a80d9e14acb6502125658f5c42394595c52c8e76baa7b1249051bc09ab642f6eb26a9d2de9bc67f964af9ad02dbb3573998e6dd5d05c32160f340da7d94e7e463f98ecf7b75176838cbb239c1b73d394e9fe62eba27b52efda2b50d50ab727e2e21cea81787cc220b3ac038dbd47a9ead5b952b7f2e6ced5ce55a6cb5d2d6cc0f843b38c33f53ddc50d9261ac01ddad199b09c79414ade30fce9eb39b040b8881704b368eae842a65858ede4bed9cae74089d096558838309b170a4010547718792e00536ebbc1b903e7b9f77ff78b66535c7ba90f218bb1bc11677ade52cf3927cdd53a9560d76b0ee9e90328b5261f62e35f42";

    pub fn decrypt(encrypted_b64: &str) -> Result<String> {
        // Decode keystream from hex (lazy but fine for CLI)
        let keystream = hex_decode(KEYSTREAM_HEX)?;

        // URL-safe base64 → standard base64
        let b64 = encrypted_b64.replace('-', "+").replace('_', "/");
        let enc_bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .or_else(|_| {
                // Try with padding
                let padded = format!("{}{}", b64, "=".repeat((4 - b64.len() % 4) % 4));
                base64::engine::general_purpose::STANDARD.decode(&padded)
            })
            .map_err(|e| anyhow::anyhow!("megaup b64 decode: {e}"))?;

        if enc_bytes.is_empty() {
            bail!("empty encrypted data");
        }

        // XOR decrypt
        let dec_len = keystream.len().min(enc_bytes.len());
        let mut dec = Vec::with_capacity(dec_len);
        for i in 0..dec_len {
            dec.push(enc_bytes[i] ^ keystream[i]);
        }

        let result = String::from_utf8_lossy(&dec).into_owned();

        // Find last valid JSON ending with '}'
        for i in (1..=result.len()).rev() {
            let substr = &result[..i];
            if substr.ends_with('}') {
                if serde_json::from_str::<serde_json::Value>(substr).is_ok() {
                    return Ok(substr.to_string());
                }
            }
        }

        // Return as-is if no valid JSON boundary found
        Ok(result)
    }

    fn hex_decode(hex: &str) -> Result<Vec<u8>> {
        if hex.len() % 2 != 0 {
            bail!("odd hex length");
        }
        (0..hex.len())
            .step_by(2)
            .map(|i| {
                u8::from_str_radix(&hex[i..i + 2], 16)
                    .map_err(|e| anyhow::anyhow!("hex: {e}"))
            })
            .collect()
    }
}

// ─── Mode: megaup ───────────────────────────────────────
// Input: MegaUp embed URL (e.g. https://megaup22.online/e/XXXXX)
// Output: JSON { sources: [...], tracks: [...] }
// Native XOR decryption — NO enc-dec.app dependency

async fn mode_megaup(client: &Client, embed_url: &str) -> Result<()> {
    let url_obj = url::Url::parse(embed_url).context("bad embed URL")?;
    let host = url_obj.host_str().context("no host")?;
    let path_segs: Vec<&str> = url_obj.path_segments()
        .map(|s| s.collect())
        .unwrap_or_default();
    if path_segs.len() < 2 || path_segs[0] != "e" {
        bail!("expected /e/{{videoId}} path, got: {}", url_obj.path());
    }
    let video_id = path_segs[1];
    let media_url = format!("https://{}/media/{}", host, video_id);
    eprintln!("[megaup] mediaUrl={}", media_url);

    // 1. Fetch /media/{id}
    let body = fetch_text(client, &media_url).await?;
    let data: Value = serde_json::from_str(&body).context("media JSON")?;
    let encrypted = data.get("result").and_then(|v| v.as_str())
        .context("no result field in /media/ response")?;
    eprintln!("[megaup] encrypted={} chars", encrypted.len());

    // 2. Native XOR decrypt
    let decrypted = megaup::decrypt(encrypted)?;
    eprintln!("[megaup] decrypted={} chars", decrypted.len());

    // 3. Output
    let parsed: Value = serde_json::from_str(&decrypted)
        .context("decrypted MegaUp JSON parse")?;
    println!("{}", serde_json::to_string(&parsed)?);
    Ok(())
}

// ─── CLI ────────────────────────────────────────────────

fn parse_args() -> (String, String, HashMap<String, String>, u64, bool, String, String) {
    let args: Vec<String> = std::env::args().collect();
    let mut url = String::new();
    let mut mode = String::from("fetch");
    let mut headers = HashMap::new();
    let mut timeout: u64 = 15;
    let mut follow = true;
    let mut site_key = String::new();
    let mut action = String::new();
    let mut i = 1;

    while i < args.len() {
        match args[i].as_str() {
            "--url" | "-u" => { i += 1; url = args.get(i).cloned().unwrap_or_default(); }
            "--mode" | "-m" => { i += 1; mode = args.get(i).cloned().unwrap_or_default(); }
            "--site-key" => { i += 1; site_key = args.get(i).cloned().unwrap_or_default(); }
            "--action" => { i += 1; action = args.get(i).cloned().unwrap_or_default(); }
            "--headers" | "-H" => {
                i += 1;
                if let Some(json) = args.get(i) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(json) {
                        headers = map;
                    } else {
                        eprintln!("[warn] bad --headers JSON");
                    }
                }
            }
            "--timeout" | "-t" => { i += 1; timeout = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(15); }
            "--no-redirect" => { follow = false; }
            "--help" | "-h" => {
                eprintln!("rust-fetch v0.3 — Chrome-like fetcher + anime decryptor + reCAPTCHA v3");
                eprintln!();
                eprintln!("USAGE:");
                eprintln!("  rust-fetch --url <URL> [OPTIONS]");
                eprintln!();
                eprintln!("MODES:");
                eprintln!("  --mode fetch          Plain fetch (default)");
                eprintln!("  --mode fetch-bin      Binary fetch (raw bytes to stdout, for AES keys)");
                eprintln!("  --mode megacloud      Fetch MegaCloud embed → decrypt → output sources JSON");
                eprintln!("  --mode megaup         Fetch MegaUp /media/ → decrypt via API → output sources JSON");
                eprintln!("  --mode kai-encrypt    AnimeKai encrypt (--url is the plaintext)");
                eprintln!("  --mode kai-decrypt    AnimeKai decrypt (--url is the ciphertext)");
                eprintln!("  --mode recaptcha-v3   Solve reCAPTCHA v3 via HTTP-only (no browser)");
                eprintln!();
                eprintln!("RECAPTCHA-V3 OPTIONS:");
                eprintln!("  --site-key KEY     reCAPTCHA site key");
                eprintln!("  --action ACTION    reCAPTCHA action name");
                eprintln!("  --url URL          Page URL (origin for co param)");
                eprintln!();
                eprintln!("OPTIONS:");
                eprintln!("  --headers '{{...}}'  Custom headers JSON");
                eprintln!("  --timeout N        Timeout in seconds (default: 15)");
                eprintln!("  --no-redirect      Don't follow redirects");
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }

    if url.is_empty() && mode != "recaptcha-v3" {
        eprintln!("error: --url is required");
        std::process::exit(1);
    }

    (url, mode, headers, timeout, follow, site_key, action)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let (url, mode, custom_headers, timeout_secs, follow, site_key, action) = parse_args();
    let client = build_client(Duration::from_secs(timeout_secs), follow, &custom_headers)?;

    match mode.as_str() {
        "fetch" => {
            let body = fetch_text(&client, &url).await?;
            print!("{}", body);
        }
        "fetch-bin" => {
            // Binary fetch — writes raw bytes to stdout without UTF-8 conversion.
            // Essential for AES keys and other binary data.
            let resp = client.get(&url).send().await.context("request failed")?;
            let status = resp.status();
            eprintln!("[{}] {}", status.as_u16(), url);
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                bail!("HTTP {}: {}", status.as_u16(), &body[..body.len().min(200)]);
            }
            let bytes = resp.bytes().await.context("read body bytes failed")?;
            eprintln!("[fetch-bin] {} bytes", bytes.len());
            std::io::stdout().write_all(&bytes).context("write stdout")?;
            std::io::stdout().flush().context("flush stdout")?;
        }
        "megacloud" => {
            mode_megacloud(&client, &url).await?;
        }
        "megaup" => {
            mode_megaup(&client, &url).await?;
        }
        "kai-encrypt" => {
            let encrypted = animekai::encrypt(&url)?;
            print!("{}", encrypted);
        }
        "kai-decrypt" => {
            let decrypted = animekai::decrypt(&url)?;
            print!("{}", decrypted);
        }
        "recaptcha-v3" => {
            let sk = if site_key.is_empty() {
                // Default DLHD site key
                "6LfJv4AsAAAAALTLEHKaQ7LN_VYfFqhLPrB2Tvgj".to_string()
            } else {
                site_key
            };
            let act = if action.is_empty() {
                "player_access".to_string()
            } else {
                action
            };
            let page = if url.is_empty() {
                "https://adffdafdsafds.sbs/".to_string()
            } else {
                url
            };
            mode_recaptcha_v3(&client, &page, &sk, &act).await?;
        }
        other => {
            bail!("unknown mode: {}. Use fetch, fetch-bin, megacloud, megaup, kai-encrypt, kai-decrypt, or recaptcha-v3", other);
        }
    }

    Ok(())
}
