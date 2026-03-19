'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import './about.css';

const sections = [
  { id: 'abstract', title: 'Abstract' },
  { id: 'introduction', title: 'Introduction' },
  { id: 'reception', title: 'Public Reception' },
  { id: 'literature', title: 'Literature Review' },
  { id: 'methodology', title: 'Methodology' },
  { id: 'architecture', title: 'System Architecture' },
  { id: 'heist', title: 'Security Research' },
  { id: 'implementation', title: 'Implementation' },
  { id: 'features', title: 'Feature Evolution' },
  { id: 'results', title: 'Results & Analysis' },
  { id: 'discussion', title: 'Discussion' },
  { id: 'future', title: 'Future Work' },
  { id: 'conclusion', title: 'Conclusion' },
  { id: 'legal', title: 'Legal Framework' },
  { id: 'references', title: 'References' },
];

export default function AboutPage() {
  const [activeSection, setActiveSection] = useState('abstract');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress((scrollTop / docHeight) * 100);

      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 150 && rect.bottom > 150) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="about-page">
      <div className="progress-bar" style={{ width: `${progress}%` }} />

      <header className="about-header">
        <div className="journal-badge">Journal of Questionable Software Engineering • Vol. 2, Issue 1 • March 2026</div>
        <div className="last-updated">Last updated: March 4, 2026</div>
        <h1>Flyx: A Case Study in Privacy-Respecting Streaming Architecture and Web Security Research</h1>
        <p className="subtitle">
          An academic exploration of building user-respecting streaming infrastructure, documenting 
          modern web security patterns, obfuscation techniques, and the technical feasibility of 
          privacy-first design in media applications—featuring extensive documentation of reverse 
          engineering methodologies and the ongoing evolution of extraction pipelines across 11 
          providers and 3 proxy layers.
        </p>
        <div className="author">
          <span className="avatar">V</span>
          <div>
            <strong>Vynx</strong>
            <span>Independent Researcher &amp; Professional Insomniac</span>
          </div>
        </div>
        <div className="paper-meta">
          <span>Received: June 2025</span>
          <span>Revised: March 2026</span>
          <span>Accepted: March 2026</span>
          <span>Reading Time: ~30 minutes</span>
        </div>
      </header>

      <div className="about-layout">
        <nav className="about-nav">
          <div className="nav-inner">
            <div className="nav-header">
              <span className="nav-title">Table of Contents</span>
              <span className="nav-progress">{Math.round(progress)}%</span>
            </div>
            {sections.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={activeSection === s.id ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <span className="nav-num">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        <main className="about-content">

          {/* Abstract */}
          <section id="abstract">
            <h2>Abstract</h2>
            <div className="abstract-box">
              <p>
                This paper presents Flyx, a research project and technology demonstration exploring 
                privacy-respecting streaming architecture. Developed over ten months by a single 
                developer, the project investigates whether modern web applications can deliver media 
                content without invasive tracking, malicious advertising, or exploitative user 
                interfaces. The findings demonstrate that privacy-first design is technically and 
                economically viable in streaming applications.
              </p>
              <p>
                Through systematic analysis of third-party streaming providers, we document various 
                security patterns, obfuscation techniques, and authentication mechanisms. This 
                research contributes to the broader understanding of web security while demonstrating 
                that user-respecting alternatives are achievable.
              </p>
              <p>
                <strong>March 2026 Status:</strong> The platform now supports 11 registered providers 
                through a unified Provider Registry: Flixer (WASM), VidLink, AnimeKai, HiAnime, 
                VidSrc, MultiEmbed, DLHD Live TV, VIPRow (Live Sports), PPV (Pay-Per-View), CDN-Live, 
                and IPTV Stalker. Each required unique cryptographic analysis—from AES-256-CBC to 
                Rust-compiled WebAssembly to Proof-of-Work authentication systems to IPTV portal 
                MAC authentication.
              </p>
              <p>
                <strong>Key Breakthroughs Since January 2026:</strong> HiAnime/MegaCloud extraction 
                via Cloudflare Worker with TLS fingerprint bypass. VIPRow live sports with Casthill 
                token refresh and boanki.net authentication. PPV event streaming through residential 
                proxy. IPTV Stalker portal integration with MAC-based authentication. Full provider 
                registry architecture with priority ordering, content-type filtering, and automatic 
                fallback chains.
              </p>
              <p>
                <strong>Hybrid Anime System:</strong> TMDB for fast browsing, MAL for accurate episode 
                data. Automatic conversion handles absolute episode numbering (e.g., JJK episode 48 
                → MAL Season 3 Episode 1). HiAnime as secondary anime provider with MegaCloud CDN 
                bypass. Copy Stream URL button lets users watch in VLC/IINA.
              </p>
              <p>
                <strong>Keywords:</strong> Streaming Architecture, Reverse Engineering, Privacy-First Design, 
                Obfuscation Analysis, Web Security Research, AES-256-CBC, AES-128, AES-256-CTR, WASM, 
                WebAssembly, Rust, Ghidra, Proof-of-Work, HMAC-SHA256, Bearer Token Authentication, 
                Chromecast, AirPlay, TV Navigation, OpenSubtitles, Browser Fingerprinting, MAL Integration, 
                Provider Registry, TLS Fingerprinting, IPTV Stalker, MAC Authentication, Residential Proxy
              </p>
            </div>
          </section>

          {/* Introduction */}
          <section id="introduction">
            <h2>1. Introduction</h2>
            
            <h3>1.1 The State of Free Streaming (A Horror Story)</h3>
            <p className="lead">
              The year is 2026. Humanity has achieved remarkable technological feats. We have sent 
              robots to Mars. We have developed artificial intelligence that can write poetry and 
              generate images of cats wearing business suits. And yet, if you want to watch a movie 
              for free on the internet, you must first navigate an obstacle course of pop-up 
              advertisements, fake download buttons, cryptocurrency miners, and user interfaces that 
              appear to have been designed by a committee of people who have never actually used a 
              computer.
            </p>
            <p>
              This is not hyperbole. This is Tuesday.
            </p>
            <p>
              The pirate streaming ecosystem represents one of the most hostile environments on the 
              modern web. Users seeking free access to movies and television are routinely subjected 
              to an arsenal of exploitative practices that would make a used car salesman blush. 
              Pop-up advertisements spawn endlessly, like some sort of digital hydra. Fake &quot;close&quot; 
              buttons trigger additional advertisements, because apparently the first seventeen were 
              not enough. Cryptocurrency miners run silently in the background, turning your laptop 
              into a space heater while generating approximately $0.003 worth of Monero for someone 
              in a country you cannot pronounce.
            </p>

            <h3>1.2 The Implicit Assumption (And Why It&apos;s Wrong)</h3>
            <p>
              Underlying this entire ecosystem is an assumption so pervasive that most people have 
              stopped questioning it: <strong>free content requires exploitation</strong>. If you are 
              not paying with money, you must pay with your security, your privacy, your CPU cycles, 
              and your sanity. This is presented as an immutable law of the universe, like gravity or 
              the tendency of software projects to exceed their estimated completion dates by a factor 
              of three.
            </p>
            <p>
              We reject this assumption. Not on philosophical grounds (though we have those too), but 
              on empirical ones. This project exists as a counterexample. It is an existence proof that 
              free streaming can exist without exploitation. The exploitation is not a technical 
              requirement—it is a business decision.
            </p>
            <p>
              The pirate streaming sites could choose to operate without malware. They could choose 
              not to mine cryptocurrency on users&apos; devices. They could choose not to serve 
              seventeen pop-up advertisements before allowing access to a video. They simply choose 
              not to, because exploitation is more profitable than ethics.
            </p>

            <blockquote>
              &quot;The question is not whether ethical piracy is possible. We have demonstrated that 
              it is. The question is why the unethical pirates continue to choose exploitation when 
              alternatives exist. The answer, of course, is money. It is always money.&quot;
              <cite>- Research Conclusions, Section 12.4</cite>
            </blockquote>

            <h3>1.3 Research Questions</h3>
            <p>
              This project began with fundamental questions about streaming architecture: Can a 
              streaming platform be built that respects user privacy? What are the technical 
              requirements for privacy-first media delivery? How do existing providers protect 
              their systems, and what can we learn from analyzing these protections?
            </p>

            <h3>1.4 Scope and Contributions</h3>
            <p>This research makes the following contributions:</p>
            <ul>
              <li><strong>Proof of Concept:</strong> A functional streaming platform demonstrating 
              privacy-respecting architecture without advertisements, tracking, or exploitative patterns.</li>
              <li><strong>Security Research Documentation:</strong> Comprehensive analysis of 11 providers 
              including WASM binary analysis, PoW authentication, position-dependent ciphers, TLS 
              fingerprint bypass, and IPTV portal authentication. 
              <Link href="/reverse-engineering" className="inline-link">Read the full technical breakdown →</Link></li>
              <li><strong>Unified Provider Registry:</strong> A production-grade architecture with 
              priority ordering, content-type filtering, automatic fallback, and error isolation.</li>
              <li><strong>Hybrid Anime System:</strong> TMDB + MAL integration with automatic episode 
              mapping for absolute-numbered anime series, dual provider support (AnimeKai + HiAnime).</li>
              <li><strong>Multi-Platform Support:</strong> Chromecast, AirPlay, TV remote navigation, 
              Copy URL for external players, and live sports streaming.</li>
            </ul>
          </section>

          <section id="reception">
            <h2>2. Public Response and Validation</h2>
            
            <h3>2.1 Community Feedback</h3>
            <p className="lead">
              The project received significant attention after being shared publicly, validating 
              the core hypothesis that users prefer privacy-respecting alternatives.
            </p>

            <h3>2.2 Feature Development</h3>
            <p>User feedback drove rapid feature development:</p>
            <div className="feedback-highlights">
              <div className="feedback-item">
                <span className="feedback-icon">📺</span>
                <div>
                  <h4>Casting Support</h4>
                  <p>Chromecast and AirPlay for TV viewing. Now includes Live TV and Live Sports casting.</p>
                </div>
              </div>
              <div className="feedback-item">
                <span className="feedback-icon">📝</span>
                <div>
                  <h4>Subtitle System</h4>
                  <p>29 languages via OpenSubtitles with sync adjustment. Non-UTF8 encoding support 
                  (Arabic, Hebrew, Russian, Chinese, Japanese, Korean).</p>
                </div>
              </div>
              <div className="feedback-item">
                <span className="feedback-icon">🎮</span>
                <div>
                  <h4>TV Navigation</h4>
                  <p>Full spatial navigation for Fire TV, Android TV, and D-pad devices.</p>
                </div>
              </div>
              <div className="feedback-item">
                <span className="feedback-icon">🎌</span>
                <div>
                  <h4>Hybrid Anime System</h4>
                  <p>TMDB browse + MAL details. Dual providers: AnimeKai (primary) + HiAnime (fallback). 
                  Automatic episode mapping for absolute-numbered series.</p>
                </div>
              </div>
              <div className="feedback-item">
                <span className="feedback-icon">🏟️</span>
                <div>
                  <h4>Live Sports &amp; PPV</h4>
                  <p>VIPRow integration for live sports events. PPV streaming for pay-per-view events. 
                  Casthill token refresh for uninterrupted viewing.</p>
                </div>
              </div>
              <div className="feedback-item">
                <span className="feedback-icon">📋</span>
                <div>
                  <h4>Copy Stream URL</h4>
                  <p>Watch in VLC, IINA, mpv, or any external player. One-click copy.</p>
                </div>
              </div>
            </div>

            <h3>2.3 Usage Metrics</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">15K+</span>
                <span className="stat-label">Active users</span>
              </div>
              <div className="stat">
                <span className="stat-value">850+</span>
                <span className="stat-label">Live TV channels</span>
              </div>
              <div className="stat">
                <span className="stat-value">11</span>
                <span className="stat-label">Providers registered</span>
              </div>
              <div className="stat">
                <span className="stat-value">0</span>
                <span className="stat-label">Users tracked</span>
              </div>
            </div>
          </section>

          {/* Literature Review */}
          <section id="literature">
            <h2>3. Literature Review</h2>
            
            <h3>3.1 The Exploitation Economy</h3>
            <p>
              Academic research into pirate streaming sites has documented what users have known for 
              years: these platforms are terrible. Rafique et al. (2016) found that over 50% of 
              visitors to major pirate streaming sites were served malware through advertisements. 
              This is not a bug; it is the business model.
            </p>
            <p>
              Konoth et al. (2018) documented the rise of in-browser cryptocurrency mining, a practice 
              that combines the excitement of watching your CPU usage spike to 100% with the financial 
              reward of generating approximately nothing for yourself while making someone else slightly 
              less poor.
            </p>

            <h3>3.2 The Dark Patterns Epidemic</h3>
            <p>
              Gray et al. (2018) coined the term &quot;dark patterns&quot; to describe user interface 
              designs that trick users into doing things they did not intend. Pirate streaming sites 
              have elevated this to an art form. Fake close buttons, hidden redirects, misleading 
              download links, and countdown timers that reset when you are not looking.
            </p>

            <h3>3.3 The &quot;Necessary Evil&quot; Myth (A Comprehensive Debunking)</h3>
            <p>
              Defenders of exploitative practices often argue that they are economically necessary. 
              &quot;Servers cost money,&quot; they say, as if this explains why clicking a play button 
              should open seventeen browser tabs and install a toolbar nobody asked for.
            </p>

            <div className="economic-analysis">
              <h4>The Pirate Site Business Model</h4>
              <ul>
                <li><strong>Content Hosting:</strong> $0 (they don&apos;t host content, they aggregate it)</li>
                <li><strong>Server Costs:</strong> Minimal (static HTML + JavaScript, easily cached)</li>
                <li><strong>CDN Costs:</strong> $0 (they use other people&apos;s CDNs)</li>
                <li><strong>Revenue:</strong> Substantial (malicious ads, crypto mining, affiliate schemes)</li>
                <li><strong>Profit Margin:</strong> Excellent (when your costs are near-zero, everything is profit)</li>
              </ul>

              <h4>Our Model (For Comparison)</h4>
              <ul>
                <li><strong>Content Hosting:</strong> $0 (we also don&apos;t host content)</li>
                <li><strong>Server Costs:</strong> $0 (Cloudflare Pages + Workers free tier)</li>
                <li><strong>Database:</strong> $0 (Cloudflare D1 free tier)</li>
                <li><strong>Residential Proxy:</strong> $0 (Raspberry Pi on home internet)</li>
                <li><strong>Revenue:</strong> $0 (no ads, no tracking, no monetization)</li>
                <li><strong>Profit Margin:</strong> Undefined (0/0 is mathematically problematic)</li>
              </ul>
            </div>

            <p>
              The fascinating thing about this comparison is that <strong>both models work</strong>. 
              The pirate sites are not serving malware because they have to. They are serving malware 
              because they want to. The exploitation is not a technical requirement—it is a business 
              decision driven by profit maximization.
            </p>

            <blockquote>
              &quot;The &apos;we need aggressive monetization to survive&apos; argument falls apart 
              when someone builds the same service on free tiers and operates it at zero cost. At 
              that point, you are not defending a necessary evil. You are defending an unnecessary 
              one that happens to be profitable.&quot;
              <cite>- Economic Analysis, Section 3.3.2</cite>
            </blockquote>
          </section>

          {/* Methodology */}
          <section id="methodology">
            <h2>4. Methodology</h2>
            
            <h3>4.1 Research Design</h3>
            <p>
              This study employs what academics call &quot;constructive research methodology&quot; and 
              what normal people call &quot;building the thing and seeing if it works.&quot;
            </p>
            <div className="phases">
              <div className="phase">
                <span className="phase-num">01</span>
                <div>
                  <h4>Requirements Analysis</h4>
                  <p>Feature prioritization, technology evaluation, and the gradual realization that 
                  this project was going to be significantly more complicated than initially anticipated.</p>
                  <span className="phase-time">Weeks 1-3</span>
                </div>
              </div>
              <div className="phase">
                <span className="phase-num">02</span>
                <div>
                  <h4>Core Development</h4>
                  <p>Building the platform, reverse engineering stream providers, and developing an 
                  intimate familiarity with the JavaScript debugger.</p>
                  <span className="phase-time">Weeks 4-16</span>
                </div>
              </div>
              <div className="phase">
                <span className="phase-num">03</span>
                <div>
                  <h4>Provider Migration &amp; Expansion</h4>
                  <p>Deprecating 2Embed and MoviesAPI. Adding Vidsrc, VidLink, AnimeKai, Flixer WASM, 
                  111movies, MegaUp, and DLHD Live TV.</p>
                  <span className="phase-time">Weeks 17-28</span>
                </div>
              </div>
              <div className="phase">
                <span className="phase-num">04</span>
                <div>
                  <h4>January 2026: Security Battles</h4>
                  <p>DLHD PoW authentication, timestamp validation bypass, domain migration handling, 
                  hybrid anime system with MAL integration. AnimeKai 183-table cipher fully native.</p>
                  <span className="phase-time">Weeks 29-32</span>
                </div>
              </div>
              <div className="phase">
                <span className="phase-num">05</span>
                <div>
                  <h4>February-March 2026: Provider Registry &amp; Live Sports</h4>
                  <p>Unified Provider Registry with 11 providers. HiAnime/MegaCloud TLS fingerprint 
                  bypass. VIPRow live sports with Casthill authentication. PPV events. IPTV Stalker 
                  portal integration. CDN-Live decoder. Full provider architecture rewrite.</p>
                  <span className="phase-time">Weeks 33-40</span>
                </div>
              </div>
            </div>

            <h3>4.2 Development Constraints</h3>
            <div className="constraints">
              <div className="constraint">
                <span className="icon">👤</span>
                <h4>Single Developer</h4>
                <p>All code, design, and documentation produced by one individual.</p>
              </div>
              <div className="constraint">
                <span className="icon">💸</span>
                <h4>Zero Budget</h4>
                <p>Only free tiers of services utilized. Cloudflare Pages, D1, Workers, plus a Raspberry Pi.</p>
              </div>
              <div className="constraint">
                <span className="icon">🌙</span>
                <h4>Part-Time Effort</h4>
                <p>Development conducted during evenings and weekends, averaging 15-20 hours per week.</p>
              </div>
            </div>
          </section>

          {/* Architecture */}
          <section id="architecture">
            <h2>5. System Architecture</h2>
            
            <h3>5.1 Architectural Philosophy</h3>
            <p>
              The Flyx architecture is guided by a simple principle: minimize complexity, maximize 
              reliability, and never, under any circumstances, require the developer to wake up at 
              3 AM because a server crashed. This led us to embrace serverless computing with the 
              enthusiasm of someone who has been personally victimized by server maintenance.
            </p>

            <h3>5.2 Technology Stack</h3>
            <div className="tech-stack">
              <div className="tech-item">
                <strong>Next.js 16 + React 19</strong>
                <p>App Router, server-side rendering, API routes for the proxy layer, Turbopack builds.</p>
              </div>
              <div className="tech-item">
                <strong>Cloudflare Workers (4 Workers)</strong>
                <p>Media proxy, DLHD extractor, sync worker, CDN-Live extractor. Global edge network.</p>
              </div>
              <div className="tech-item">
                <strong>Cloudflare Pages + D1</strong>
                <p>Hosting and two SQLite databases at the edge. Free tiers handle all traffic.</p>
              </div>
              <div className="tech-item">
                <strong>HLS.js + mpegts.js</strong>
                <p>HLS for VOD, mpegts.js for Live TV. Optimized buffer settings for smooth playback.</p>
              </div>
              <div className="tech-item">
                <strong>Raspberry Pi Residential Proxy</strong>
                <p>Home internet IP for CDNs that block datacenter IPs. Handles AnimeKai, Flixer, 
                VidLink, VidSrc, 1movies, HiAnime, and VIPRow CDN requests.</p>
              </div>
              <div className="tech-item">
                <strong>11 Stream Providers</strong>
                <p>Unified Provider Registry with priority ordering, content-type filtering, and 
                automatic fallback chains.</p>
              </div>
            </div>

            <h3>5.3 Provider Registry Architecture</h3>
            <p>
              The February 2026 rewrite introduced a unified Provider Registry—a central system that 
              manages all 11 providers through a common interface. Each provider declares its supported 
              content types, priority level, and extraction logic. The registry handles discovery, 
              ordering, and error isolation so a single broken provider never crashes the system.
            </p>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">11</span>
                <span className="stat-label">Registered providers</span>
              </div>
              <div className="stat">
                <span className="stat-value">7</span>
                <span className="stat-label">Content categories</span>
              </div>
              <div className="stat">
                <span className="stat-value">4</span>
                <span className="stat-label">CF Workers</span>
              </div>
              <div className="stat">
                <span className="stat-value">3</span>
                <span className="stat-label">Proxy layers</span>
              </div>
            </div>

            <h3>5.4 Multi-Layer Proxy Architecture</h3>
            <p>
              Multiple CDNs block datacenter IPs and reject requests with Origin headers. Our 
              three-layer proxy solution routes requests through the appropriate path based on 
              provider-specific CDN requirements:
            </p>
            <div className="proxy-flow">
              <div className="proxy-step">Browser (XHR with Origin)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">Next.js API Route (strips Origin)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">Cloudflare Worker (provider-specific routing)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step highlight">Raspberry Pi (Residential IP)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">CDN → HLS Stream</div>
            </div>
            <p>
              Each provider has dedicated proxy routes: <code>/animekai</code>, <code>/flixer/stream</code>, 
              <code>/hianime</code>, <code>/viprow/stream</code>, <code>/cdn-live/stream</code>, 
              <code>/ppv/stream</code>. The Cloudflare Worker detects CDN domains and routes to the 
              appropriate RPI endpoint with provider-specific headers.
            </p>
          </section>

          {/* The Heist */}
          <section id="heist">
            <h2>6. Security Research: Provider Analysis</h2>
            
            <h3>6.1 Research Motivation</h3>
            <p className="lead">
              This project serves as a practical study in web security, obfuscation analysis, and 
              privacy-respecting architecture. Understanding these systems contributes to broader 
              knowledge in the security research community.
            </p>

            <h3>6.2 Providers Analyzed (March 2026)</h3>
            <div className="provider-grid">
              <div className="provider-card">
                <h4>🔐 Flixer (WASM)</h4>
                <p>Rust-compiled WebAssembly with AES-256-CTR + HMAC. Browser fingerprinting. 
                Solution: Bundle WASM binary with mocked browser APIs in Cloudflare Worker.</p>
              </div>
              <div className="provider-card">
                <h4>📺 DLHD Live TV</h4>
                <p>Proof-of-Work authentication. HMAC-SHA256 + MD5 nonce. Timestamp must be 5-10 
                seconds in the past. Domain: dvalna.ru. Server-side segment decryption.</p>
              </div>
              <div className="provider-card">
                <h4>🎌 AnimeKai</h4>
                <p>183-table position-dependent substitution cipher. Fully native encryption/decryption. 
                Zero external dependencies. Routes through MegaUp CDN.</p>
              </div>
              <div className="provider-card">
                <h4>🔓 MegaUp</h4>
                <p>User-Agent-based stream cipher. Pre-computed 521-byte keystream for fixed UA. 
                XOR decryption. CDN blocks datacenter IPs.</p>
              </div>
              <div className="provider-card">
                <h4>🎬 111movies</h4>
                <p>AES-256-CBC + XOR + Base64 + alphabet substitution. Five layers of obfuscation. 
                CDN uses Cloudflare Workers that block other Workers.</p>
              </div>
              <div className="provider-card">
                <h4>📡 VidSrc + Uflix</h4>
                <p>VidSrc: static hex/base64 decoders with character manipulation. Uflix: 5 embed servers via gStream API, no encryption.</p>
              </div>
              <div className="provider-card">
                <h4>🔬 HiAnime / MegaCloud</h4>
                <p>TLS fingerprinting on CDN. Cloudflare Worker extraction with RPI proxy for CDN 
                bypass. MegaCloud uses rabbitstream/vidcloud domains.</p>
              </div>
              <div className="provider-card">
                <h4>🏟️ VIPRow (Live Sports)</h4>
                <p>Casthill.net stream extraction. Boanki.net token authentication. Manifest URL 
                rewriting. Key and segment proxying through CF Worker.</p>
              </div>
              <div className="provider-card">
                <h4>🥊 PPV (Pay-Per-View)</h4>
                <p>Live event streaming through residential proxy. CF Worker /ppv endpoint handles 
                extraction and proxying.</p>
              </div>
              <div className="provider-card">
                <h4>📡 CDN-Live</h4>
                <p>Dedicated CDN-Live decoder with proper Referer handling. URL rewriting for 
                CDN-Live streams. Separate CF Worker route.</p>
              </div>
              <div className="provider-card">
                <h4>📺 IPTV Stalker</h4>
                <p>Portal-based IPTV with MAC address authentication. Residential proxy required 
                for portal access. Token-based stream authentication.</p>
              </div>
            </div>

            <h3>6.3 The Battles We Overcame</h3>
            <div className="war-story">
              <h4>🔥 The DLHD PoW Wars (January 2026)</h4>
              <p>
                DLHD updated their security three times in January alone. First came Proof-of-Work 
                authentication with HMAC-SHA256 + MD5 nonce computation. We cracked it in hours. Then 
                they added timestamp validation—timestamps had to be 5-10 seconds in the past. We 
                discovered the sweet spot: exactly 7 seconds. Then they migrated domains from 
                daddyhd.com to dvalna.ru. Each time, we adapted within hours.
              </p>
            </div>
            <div className="war-story">
              <h4>🧩 The AnimeKai Cipher (December 2025)</h4>
              <p>
                AnimeKai uses a position-dependent substitution cipher with 183 unique tables—one for 
                each character position. We spent weeks building all 183 tables through systematic 
                analysis, eventually achieving 100% native encryption/decryption with zero external 
                dependencies. The cipher looked complex, but once we realized it was position-dependent 
                with no key derivation, building the tables was just tedious, not hard.
              </p>
            </div>
            <div className="war-story">
              <h4>🔐 The Flixer WASM Midnight Session (December 21, 2025)</h4>
              <p>
                Flixer uses a Rust-compiled WebAssembly module for AES-256-CTR encryption with HMAC 
                authentication and browser fingerprinting. After a 12-hour reverse engineering session 
                involving Ghidra, memory forensics, and ~150 test scripts, we had the breakthrough at 
                2 AM: instead of cracking the algorithm, bundle their WASM binary and mock the browser 
                APIs server-side. If you can&apos;t beat the algorithm, become the algorithm.
              </p>
            </div>
            <div className="war-story">
              <h4>🌐 The CDN IP Wars (Ongoing)</h4>
              <p>
                MegaUp, Flixer, HiAnime, 1movies, and VIPRow CDNs all block datacenter IPs. 
                Cloudflare Workers talking to Cloudflare Workers get blocked. The solution: a 
                Raspberry Pi on home internet acting as a residential proxy. Each provider gets 
                its own dedicated route with provider-specific headers and Referer handling.
              </p>
            </div>
            <div className="war-story">
              <h4>🎌 The HiAnime TLS Fingerprint (February 2026)</h4>
              <p>
                MegaCloud CDN uses TLS fingerprinting to detect non-browser clients. Standard 
                Node.js/fetch requests get blocked even with correct headers. Solution: route 
                through the RPI proxy which uses curl-impersonate to mimic Chrome&apos;s TLS 
                handshake. The <code>/hianime</code> CF Worker route handles the full extraction 
                pipeline.
              </p>
            </div>

            <h3>6.4 Research Metrics</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">11</span>
                <span className="stat-label">Providers cracked</span>
              </div>
              <div className="stat">
                <span className="stat-value">180ms</span>
                <span className="stat-label">Average extraction</span>
              </div>
              <div className="stat">
                <span className="stat-value">98%+</span>
                <span className="stat-label">Success rate</span>
              </div>
              <div className="stat">
                <span className="stat-value">0</span>
                <span className="stat-label">Browser automation</span>
              </div>
            </div>
            <p>
              <Link href="/reverse-engineering" className="inline-link">
                → Full technical documentation with code samples
              </Link>
            </p>
          </section>

          {/* Implementation */}
          <section id="implementation">
            <h2>7. Implementation Details</h2>
            
            <h3>7.1 The Streaming Pipeline</h3>
            <ol>
              <li>Provider Registry selects providers by content type and priority</li>
              <li>Parallel extraction across multiple providers with automatic fallback</li>
              <li>Provider-specific decoders crack obfuscation and extract playable URLs</li>
              <li>Multi-layer proxy handles CORS, header spoofing, CDN routing, and residential IP forwarding</li>
              <li>Clean stream delivered to custom video player with subtitle overlay</li>
            </ol>

            <h3>7.2 Hybrid Anime System</h3>
            <p>
              TMDB for fast browsing, MAL for accurate episode data. Dual provider support with 
              AnimeKai (primary, priority 30) and HiAnime (fallback, priority 35):
            </p>
            <ul>
              <li><strong>Browse:</strong> TMDB API with Japanese origin filter</li>
              <li><strong>Details:</strong> Auto-detect anime → fetch MAL data via ARM API</li>
              <li><strong>Episode Mapping:</strong> TMDB episode 48 → MAL Season 3 Episode 1 (bounded cache)</li>
              <li><strong>Primary:</strong> AnimeKai with native 183-table cipher → MegaUp CDN</li>
              <li><strong>Fallback:</strong> HiAnime with MegaCloud CDN (TLS fingerprint bypass)</li>
              <li><strong>Sub/Dub:</strong> One-click toggle with preference memory</li>
            </ul>

            <h3>7.3 Live TV &amp; Sports Architecture</h3>
            <ul>
              <li><strong>DLHD:</strong> 850+ channels, dedicated extractor worker, server-side AES-128 decryption</li>
              <li><strong>VIPRow:</strong> Live sports events, Casthill token refresh, manifest URL rewriting</li>
              <li><strong>PPV:</strong> Pay-per-view events through residential proxy</li>
              <li><strong>CDN-Live:</strong> Dedicated decoder with URL rewriting</li>
              <li><strong>IPTV Stalker:</strong> Portal-based with MAC authentication</li>
            </ul>

            <h3>7.4 The Numbers</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">90K+</span>
                <span className="stat-label">Lines of code</span>
              </div>
              <div className="stat">
                <span className="stat-value">250+</span>
                <span className="stat-label">React components</span>
              </div>
              <div className="stat">
                <span className="stat-value">70+</span>
                <span className="stat-label">API endpoints</span>
              </div>
              <div className="stat">
                <span className="stat-value">25+</span>
                <span className="stat-label">Database tables</span>
              </div>
            </div>
          </section>

          {/* Feature Evolution */}
          <section id="features">
            <h2>8. Feature Evolution</h2>
            
            <h3>8.1 December 2025 Feature Drop</h3>
            <ul>
              <li><strong>Chromecast &amp; AirPlay:</strong> Native browser APIs, no third-party SDKs</li>
              <li><strong>TV Remote Navigation:</strong> Full spatial navigation for Fire TV, Android TV</li>
              <li><strong>29-Language Subtitles:</strong> OpenSubtitles with quality scoring</li>
              <li><strong>Subtitle Sync:</strong> G/H keys to adjust timing by 0.5 seconds</li>
              <li><strong>Pinch-to-Zoom:</strong> Double-tap for 2x, pinch up to 4x on mobile</li>
              <li><strong>Continue Watching:</strong> Progress bars, resume exactly where you left off</li>
              <li><strong>Auto-Play Next Episode:</strong> Configurable countdown timer</li>
            </ul>

            <h3>8.2 January 2026 Updates</h3>
            <ul>
              <li><strong>Copy Stream URL:</strong> One-click copy for VLC, IINA, mpv, Kodi</li>
              <li><strong>Live TV Casting:</strong> AirPlay and Chromecast for live streams</li>
              <li><strong>Non-UTF8 Subtitles:</strong> Arabic (windows-1256), Hebrew, Russian, Chinese, Japanese, Korean encoding support</li>
              <li><strong>Anime Auto-Redirect:</strong> TMDB anime pages redirect to MAL-based details</li>
              <li><strong>MAL Title Display:</strong> Actual anime titles instead of generic &quot;Season 1&quot;</li>
              <li><strong>DLHD Buffering Fix:</strong> Optimized HLS.js settings, skip segment proxying</li>
              <li><strong>JJK Season 3 Fix:</strong> Automatic episode mapping for absolute-numbered anime</li>
            </ul>

            <h3>8.3 February-March 2026 Updates</h3>
            <ul>
              <li><strong>Provider Registry:</strong> Unified architecture with 11 providers, priority ordering, 
              content-type filtering, and error isolation</li>
              <li><strong>HiAnime Integration:</strong> Secondary anime provider with MegaCloud CDN bypass 
              via TLS fingerprint impersonation</li>
              <li><strong>VIPRow Live Sports:</strong> Casthill stream extraction, boanki.net token auth, 
              manifest rewriting, key/segment proxying</li>
              <li><strong>PPV Events:</strong> Pay-per-view streaming through residential proxy</li>
              <li><strong>CDN-Live Decoder:</strong> Dedicated decoder with proper Referer handling and URL rewriting</li>
              <li><strong>IPTV Stalker:</strong> Portal-based IPTV with MAC authentication through RPI proxy</li>
              <li><strong>MultiEmbed:</strong> Additional movie/TV provider with multi-source extraction</li>
              <li><strong>Zod Validation:</strong> Runtime schema validation for content and stream data</li>
              <li><strong>Backend Switching:</strong> DLHD channels now support multiple backends with 
              obfuscated IDs (actual server names never exposed to client)</li>
            </ul>

            <h3>8.4 AnimeKai + HiAnime Dual System</h3>
            <ul>
              <li><strong>AnimeKai (Priority 30):</strong> Primary anime provider with native 183-table cipher</li>
              <li><strong>HiAnime (Priority 35):</strong> Fallback provider with MegaCloud CDN</li>
              <li><strong>Sub/Dub Toggle:</strong> One click to switch audio tracks</li>
              <li><strong>Preference Memory:</strong> Remembers your sub/dub preference</li>
              <li><strong>Skip Intro/Outro:</strong> Automatic skip markers from provider metadata</li>
              <li><strong>Auto-Detection:</strong> Japanese animation automatically uses anime providers</li>
            </ul>
          </section>

          {/* Results */}
          <section id="results">
            <h2>9. Results &amp; Analysis</h2>
            
            <h3>9.1 Primary Findings</h3>
            <div className="findings">
              <div className="finding">
                <span className="number">1</span>
                <div>
                  <h4>Exploitation Is Optional</h4>
                  <p>Flyx operates without advertisements, tracking, or malware while providing 
                  functional streaming across 11 providers. Exploitative practices are profit-maximizing 
                  choices, not technical requirements.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">2</span>
                <div>
                  <h4>Zero-Cost Operation Is Achievable</h4>
                  <p>The platform runs entirely on free tiers plus a Raspberry Pi. Cloudflare Pages, 
                  D1, Workers. The &quot;we need aggressive ads to pay for servers&quot; argument is 
                  demonstrably false.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">3</span>
                <div>
                  <h4>Security Through Obscurity Fails</h4>
                  <p>Every provider we analyzed—from WASM binaries to PoW systems to TLS fingerprinting 
                  to 183-table ciphers—was eventually cracked. Obfuscation adds friction but not security.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">4</span>
                <div>
                  <h4>Architecture Matters More Than Cleverness</h4>
                  <p>The Provider Registry pattern—with error isolation, priority ordering, and automatic 
                  fallback—proved more valuable than any individual extraction breakthrough. When DLHD 
                  updates their security, only one adapter needs updating.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Discussion */}
          <section id="discussion">
            <h2>10. Discussion</h2>
            
            <h3>10.1 Implications</h3>
            <p>
              The existence of Flyx demonstrates that exploitative practices endemic to pirate 
              streaming are not inevitable. They are choices made by operators who prioritize 
              profit over users. The operators of exploitative platforms can no longer hide behind 
              claims of necessity.
            </p>

            <h3>10.2 Limitations</h3>
            <ul>
              <li>The platform depends on third-party stream providers that may change their 
              obfuscation at any time, requiring ongoing maintenance.</li>
              <li>The legal status of content aggregation remains ambiguous in many jurisdictions.</li>
              <li>Some anime with absolute episode numbering require hardcoded overrides when MAL 
              search fails.</li>
              <li>CDNs that use TLS fingerprinting require residential proxy with curl-impersonate, 
              adding latency.</li>
              <li>IPTV Stalker portals may rotate MAC addresses or change authentication schemes.</li>
            </ul>

            <h3>10.3 The Cat-and-Mouse Reality</h3>
            <p>
              Reverse engineering streaming providers is an ongoing battle. DLHD updated their 
              security three times in January 2026 alone. HiAnime added TLS fingerprinting. VIPRow 
              rotates token endpoints. The Provider Registry architecture was designed for exactly 
              this reality—provider-specific adapters can be updated independently, and the system 
              gracefully degrades when individual providers fail.
            </p>
          </section>

          {/* Future Work */}
          <section id="future">
            <h2>11. Future Work</h2>
            
            <h3>11.1 Completed Since Initial Release</h3>
            <ul>
              <li><strong>11 Providers:</strong> Flixer, VidLink, AnimeKai, HiAnime, VidSrc, MultiEmbed, 
              DLHD, VIPRow, PPV, CDN-Live, IPTV</li>
              <li><strong>Live TV:</strong> 850+ channels with PoW authentication and server-side decryption</li>
              <li><strong>Live Sports:</strong> VIPRow with Casthill token refresh</li>
              <li><strong>Hybrid Anime:</strong> TMDB browse + MAL details with dual provider support</li>
              <li><strong>Multi-Platform:</strong> Chromecast, AirPlay, TV navigation, Copy URL</li>
              <li><strong>Subtitle System:</strong> 29 languages, sync adjustment, non-UTF8 encoding</li>
              <li><strong>Provider Registry:</strong> Unified architecture with error isolation</li>
            </ul>

            <h3>11.2 Still on the Roadmap</h3>
            <ul>
              <li><strong>Smart Recommendations:</strong> Privacy-preserving personalization</li>
              <li><strong>Progressive Web App:</strong> Offline capability and app-like experience</li>
              <li><strong>Internationalization:</strong> Multiple UI languages, RTL support</li>
              <li><strong>Watch Parties:</strong> Synchronized viewing with friends</li>
              <li><strong>Provider Health Dashboard:</strong> Real-time monitoring of extraction success rates</li>
            </ul>
          </section>

          {/* Conclusion */}
          <section id="conclusion">
            <h2>12. Conclusion: On the Feasibility of Ethical Piracy</h2>
            <p className="lead">
              We built a streaming platform. It works. It does not assault users with pop-ups, mine 
              cryptocurrency on their CPUs, or track them across the web. And we did it alone, 
              part-time, with no budget, over ten months of evenings and weekends.
            </p>
            <p>
              Eleven providers cracked. 850+ live TV channels. Live sports and PPV events. Hybrid 
              anime system with dual providers and automatic episode mapping. Chromecast, AirPlay, 
              TV navigation, Copy URL for external players. 29-language subtitles with sync adjustment. 
              A unified Provider Registry that gracefully handles provider failures. All built by one 
              person, still with no budget, still without exploiting a single user.
            </p>
            <p>
              That is the point. Not that we are special (we are not). Not that we are particularly 
              clever (debatable). The point is that if one person can do this under these constraints, 
              then every pirate streaming site that serves malware is making a choice. They could 
              treat users like humans instead of revenue sources. They choose not to because 
              exploitation is more profitable than ethics.
            </p>

            <h3>12.1 The Existence Proof</h3>
            <p>
              In mathematics, an existence proof demonstrates that something is possible without 
              necessarily showing how to construct it. This project is the opposite: a constructive 
              proof that demonstrates not only that ethical streaming aggregation is possible, but 
              exactly how to build it.
            </p>

            <h3>12.2 On Fighting Piracy with Piracy</h3>
            <p>
              There is a certain poetic justice in using piracy to fight piracy. The sites we reverse 
              engineer profit from content they do not own. We profit from... well, we do not profit 
              at all, which rather undermines the piracy metaphor, but the point stands.
            </p>

            <h3>12.3 The Broader Implications</h3>
            <ul>
              <li><strong>Exploitation is a choice:</strong> Services can operate without malware, 
              tracking, or deceptive practices.</li>
              <li><strong>Obfuscation is not security:</strong> Every protection we encountered was 
              eventually bypassed. WASM, PoW, TLS fingerprinting, 183-table ciphers—all fell.</li>
              <li><strong>Architecture outlasts cleverness:</strong> The Provider Registry pattern 
              proved more valuable than any individual hack. Good architecture absorbs change.</li>
              <li><strong>Solo development is viable:</strong> Modern tools enable individuals to build 
              production-quality services that would have required teams a decade ago.</li>
              <li><strong>Free tiers are generous:</strong> Cloudflare&apos;s free tier handles everything. 
              Add a Raspberry Pi and you have a complete streaming infrastructure.</li>
            </ul>

            <blockquote>
              &quot;The pop-ups are not necessary. The crypto miners are not necessary. The tracking 
              is not necessary. They are choices. And those choices tell you everything you need to 
              know about the people making them.&quot;
              <cite>- Final Thoughts, Section 12.4</cite>
            </blockquote>

            <h3>12.4 A Message to Users</h3>
            <p>
              You deserve better. You do not have to accept malware as the price of free content. 
              Alternatives can exist. This project is proof. Demand better from the services you use.
            </p>

            <h3>12.5 A Message to Developers</h3>
            <p>
              If you have the skills to build something, build something good. The world has enough 
              services that exploit users. Build something that respects them. The economics work. 
              The technology exists. The only question is whether you choose to use your skills for 
              good or for profit. And if you can find a way to do both, even better.
            </p>

            <h3>12.6 Final Thoughts</h3>
            <p>
              Flyx exists because we got tired of watching the internet get worse. It is proof that 
              better is possible. It is proof that exploitation is optional. It is proof that one 
              person, working part-time, with no budget, can build something that respects users.
            </p>
            <p>
              And sometimes, proof is enough.
            </p>
            <p className="signature">
              <em>- Vynx, Professional Insomniac and Occasional Pirate Hunter</em><br/>
              <em>March 2026</em>
            </p>
          </section>

          {/* Legal Framework */}
          <section id="legal">
            <h2>13. Legal Framework</h2>
            
            <div className="legal-notice">
              <p>
                <strong>IMPORTANT:</strong> The following constitutes a binding legal agreement. By 
                accessing or using Flyx, you acknowledge that you have read, understood, and agree 
                to be bound by these terms in their entirety.
              </p>
            </div>

            <h3>13.1 Nature and Purpose of Service</h3>
            <p>
              Flyx (&quot;the Platform&quot;) is a personal, non-commercial technology demonstration 
              project created solely for educational, research, and portfolio purposes. The Platform 
              does not constitute a commercial streaming service. No fees are charged for access. 
              The project generates no revenue and operates at zero profit.
            </p>

            <h3>13.2 Content Disclaimer</h3>
            <p>
              <strong>THE PLATFORM DOES NOT HOST, STORE, UPLOAD, TRANSMIT, OR DISTRIBUTE ANY VIDEO 
              CONTENT, MEDIA FILES, OR COPYRIGHTED MATERIALS ON ITS SERVERS OR INFRASTRUCTURE.</strong>
            </p>
            <p>
              All media content accessible through the Platform is sourced from third-party providers, 
              publicly available APIs, and external hosting services over which we exercise no control.
            </p>

            <h3>13.3 DMCA Compliance</h3>
            <div className="dmca-notice">
              <h4>🏴‍☠️ Dear Rights Holders: Let&apos;s Talk</h4>
              <p>
                Before you send that takedown request, let us save you some time: <strong>We do not 
                host any content.</strong> Not a single video file. Not a single stream. Nothing. We 
                are not the pirates you are looking for.
              </p>
              <p>
                What we <em>do</em> is reverse engineer the obfuscation techniques of <strong>actual 
                pirate streaming sites</strong>—the ones that are profiting from your content through 
                malicious advertising, cryptocurrency mining, and browser hijacking.
              </p>
              <p>
                We have spent hundreds of hours reverse engineering these operations. We know how 
                they work. We know their CDN providers, their obfuscation techniques, their 
                infrastructure. If you want to take down the actual pirates, we would be happy to 
                share our research. We are, in a sense, doing your job for free.
              </p>
              <p>
                <strong>Contact:</strong> legal@flyx.stream
              </p>
            </div>

            <div className="legal-footer">
              <p>Last updated: March 2026</p>
              <p>This legal framework is subject to change.</p>
            </div>
          </section>

          {/* References */}
          <section id="references">
            <h2>14. References</h2>
            <div className="references">
              <p>[1] Rafique, M. Z., et al. (2016). &quot;It&apos;s Free for a Reason: Exploring the Ecosystem of Free Live Streaming Services.&quot; NDSS Symposium.</p>
              <p>[2] Konoth, R. K., et al. (2018). &quot;MineSweeper: An In-depth Look into Drive-by Cryptocurrency Mining and Its Defense.&quot; ACM CCS.</p>
              <p>[3] Gray, C. M., et al. (2018). &quot;The Dark (Patterns) Side of UX Design.&quot; CHI Conference on Human Factors in Computing Systems.</p>
              <p>[4] Cloudflare. (2026). &quot;Workers Documentation.&quot; developers.cloudflare.com</p>
              <p>[5] Next.js. (2026). &quot;App Router Documentation.&quot; nextjs.org/docs</p>
              <p>[6] MyAnimeList. (2026). &quot;MAL API Documentation.&quot; myanimelist.net/apiconfig</p>
              <p>[7] TMDB. (2026). &quot;The Movie Database API.&quot; developer.themoviedb.org</p>
              <p>[8] NSA. (2024). &quot;Ghidra Software Reverse Engineering Framework.&quot; ghidra-sre.org</p>
            </div>

            <div className="back-link">
              <p>
                <Link href="/reverse-engineering">→ Read the full Reverse Engineering documentation</Link>
              </p>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
