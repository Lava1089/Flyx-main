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
        <div className="journal-badge">Journal of Questionable Software Engineering • Vol. 1, Issue 3 • January 2026</div>
        <div className="last-updated">Last updated: January 24, 2026</div>
        <h1>Flyx: A Case Study in Privacy-Respecting Streaming Architecture and Web Security Research</h1>
        <p className="subtitle">
          An academic exploration of building user-respecting streaming infrastructure, documenting 
          modern web security patterns, obfuscation techniques, and the technical feasibility of 
          privacy-first design in media applications—featuring extensive documentation of reverse 
          engineering methodologies and the ongoing evolution of extraction pipelines.
        </p>
        <div className="author">
          <span className="avatar">V</span>
          <div>
            <strong>Vynx</strong>
            <span>Independent Researcher & Professional Insomniac</span>
          </div>
        </div>
        <div className="paper-meta">
          <span>Received: June 2025</span>
          <span>Revised: January 2026</span>
          <span>Accepted: January 2026</span>
          <span>Reading Time: ~25 minutes</span>
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
                privacy-respecting streaming architecture. Developed over eight months, the project 
                investigates whether modern web applications can deliver media content without 
                invasive tracking, malicious advertising, or exploitative user interfaces. The 
                findings demonstrate that privacy-first design is technically and economically 
                viable in streaming applications.
              </p>
              <p>
                Through systematic analysis of third-party streaming providers, we document various 
                security patterns, obfuscation techniques, and authentication mechanisms. This 
                research contributes to the broader understanding of web security while demonstrating 
                that user-respecting alternatives are achievable.
              </p>
              <p>
                <strong>Update (January 2026):</strong> The platform has undergone significant 
                evolution. We now support 8 fully reverse-engineered providers: Vidsrc, VidLink, 
                AnimeKai, MegaUp, Flixer (WASM), 111movies, and DLHD Live TV. Each provider required 
                unique cryptographic analysis—from AES-256-CBC to Rust-compiled WebAssembly to 
                Proof-of-Work authentication systems.
              </p>
              <p>
                <strong>January 2026 Breakthroughs:</strong> DLHD Live TV now uses Proof-of-Work 
                authentication with HMAC-SHA256 + MD5 nonce computation. We cracked their timestamp 
                validation (must be 5-10 seconds in the past) and domain migration to dvalna.ru. 
                AnimeKai&apos;s 183-table position-dependent substitution cipher is now fully native. 
                MegaUp&apos;s User-Agent-based stream cipher has been pre-computed.
              </p>
              <p>
                <strong>Hybrid Anime System:</strong> TMDB for fast browsing, MAL for accurate episode 
                data. Automatic conversion handles absolute episode numbering (e.g., JJK episode 48 
                → MAL Season 3 Episode 1). Copy Stream URL button lets users watch in VLC/IINA.
              </p>
              <p>
                <strong>Keywords:</strong> Streaming Architecture, Reverse Engineering, Privacy-First Design, 
                Obfuscation Analysis, Web Security Research, AES-256-CBC, AES-128, AES-256-CTR, WASM, 
                WebAssembly, Rust, Ghidra, Proof-of-Work, HMAC-SHA256, Bearer Token Authentication, 
                Chromecast, AirPlay, TV Navigation, OpenSubtitles, Browser Fingerprinting, MAL Integration
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

            <h3>1.2 The Implicit Assumption (And Why It's Wrong)</h3>
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
            <blockquote>
              &quot;The best way to prove something is possible is to do it. The second best way is to 
              write a really long document about doing it and hope people believe you.&quot;
              <cite>- Research Philosophy</cite>
            </blockquote>

            <h3>1.4 Scope and Contributions</h3>
            <p>This research makes the following contributions:</p>
            <ul>
              <li><strong>Proof of Concept:</strong> A functional streaming platform demonstrating 
              privacy-respecting architecture without advertisements, tracking, or exploitative patterns.</li>
              <li><strong>Security Research Documentation:</strong> Comprehensive analysis of 8 providers 
              including WASM binary analysis, PoW authentication, and position-dependent ciphers. 
              <Link href="/reverse-engineering" className="inline-link">Read the full technical breakdown →</Link></li>
              <li><strong>Hybrid Anime System:</strong> TMDB + MAL integration with automatic episode 
              mapping for absolute-numbered anime series.</li>
              <li><strong>Multi-Platform Support:</strong> Chromecast, AirPlay, TV remote navigation, 
              and Copy URL for external players like VLC.</li>
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
                  <p>Chromecast and AirPlay for TV viewing. Now includes Live TV casting.</p>
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
                  <p>TMDB browse + MAL details. Automatic episode mapping for absolute-numbered series.</p>
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
                <span className="stat-value">8</span>
                <span className="stat-label">Providers cracked</span>
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
              should open seventeen browser tabs and install a toolbar nobody asked for. &quot;We need 
              to monetize somehow,&quot; they claim, as if the only options are malware or bankruptcy.
            </p>
            <p>
              This argument deserves scrutiny, primarily because it is demonstrably false. Let us 
              examine the economics:
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
                <li><strong>Server Costs:</strong> $0 (Vercel free tier, Cloudflare Workers free tier)</li>
                <li><strong>Database:</strong> $0 (Neon PostgreSQL free tier)</li>
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

            <p>
              Modern serverless platforms offer free tiers that can handle substantial traffic. 
              Cloudflare Workers provides 100,000 requests per day for free. Vercel offers generous 
              bandwidth allowances. Neon PostgreSQL has a free tier that is more than sufficient for 
              user data. The infrastructure costs for a streaming aggregation service are, in 2026, 
              effectively zero for moderate traffic levels.
            </p>

            <blockquote>
              &quot;The &apos;we need aggressive monetization to survive&apos; argument falls apart 
              when someone builds the same service on free tiers and operates it at zero cost. At 
              that point, you are not defending a necessary evil. You are defending an unnecessary 
              one that happens to be profitable.&quot;
              <cite>- Economic Analysis, Section 3.3.2</cite>
            </blockquote>

            <p>
              To be clear: we are not arguing that all advertising is evil, or that content creators 
              should not be compensated. We are arguing that the specific monetization practices 
              employed by pirate streaming sites—malware, cryptocurrency mining, deceptive interfaces—are 
              not economically necessary. They are choices. And those choices reveal the priorities of 
              the people making them.
            </p>
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
                  <h4>Provider Migration & Expansion</h4>
                  <p>Deprecating 2Embed and MoviesAPI. Adding Vidsrc, VidLink, AnimeKai, Flixer WASM, 
                  111movies, MegaUp, and DLHD Live TV.</p>
                  <span className="phase-time">Weeks 17-28</span>
                </div>
              </div>
              <div className="phase">
                <span className="phase-num">04</span>
                <div>
                  <h4>January 2026 Security Updates</h4>
                  <p>DLHD PoW authentication, timestamp validation bypass, domain migration handling, 
                  hybrid anime system with MAL integration.</p>
                  <span className="phase-time">Weeks 29-32</span>
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
                <p>Only free tiers of services utilized. Vercel, Neon, Cloudflare Workers.</p>
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
                <strong>Next.js 16</strong>
                <p>App Router, server-side rendering, API routes for the proxy layer, Turbopack builds.</p>
              </div>
              <div className="tech-item">
                <strong>Cloudflare Workers</strong>
                <p>Edge proxy for DLHD Live TV, Flixer WASM bundling, stream proxying. Global CDN.</p>
              </div>
              <div className="tech-item">
                <strong>Vercel + Neon PostgreSQL</strong>
                <p>Hosting and serverless database. Free tiers handle all traffic.</p>
              </div>
              <div className="tech-item">
                <strong>HLS.js + mpegts.js</strong>
                <p>HLS for VOD, mpegts.js for Live TV. Optimized buffer settings for smooth playback.</p>
              </div>
              <div className="tech-item">
                <strong>8 Stream Providers</strong>
                <p>Vidsrc, VidLink, AnimeKai, MegaUp, Flixer, 111movies, DLHD, and fallbacks.</p>
              </div>
            </div>

            <h3>5.3 Multi-Layer Proxy Architecture</h3>
            <p>
              Multiple CDNs block datacenter IPs and reject requests with Origin headers. Our solution:
            </p>
            <div className="proxy-flow">
              <div className="proxy-step">Browser (XHR with Origin)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">Vercel API Route</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">Cloudflare Worker</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step highlight">Raspberry Pi (Residential IP)</div>
              <div className="proxy-arrow">↓</div>
              <div className="proxy-step">CDN → HLS Stream</div>
            </div>
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

            <h3>6.2 Providers Analyzed (January 2026)</h3>
            <div className="provider-grid">
              <div className="provider-card">
                <h4>🔐 Flixer (WASM)</h4>
                <p>Rust-compiled WebAssembly with AES-256-CTR + HMAC. Browser fingerprinting. 
                Solution: Bundle WASM binary with mocked browser APIs.</p>
              </div>
              <div className="provider-card">
                <h4>📺 DLHD Live TV</h4>
                <p>Proof-of-Work authentication. HMAC-SHA256 + MD5 nonce. Timestamp must be 5-10 
                seconds in the past. Domain: dvalna.ru.</p>
              </div>
              <div className="provider-card">
                <h4>🎌 AnimeKai</h4>
                <p>183-table position-dependent substitution cipher. Fully native encryption/decryption. 
                Zero external dependencies.</p>
              </div>
              <div className="provider-card">
                <h4>🔓 MegaUp</h4>
                <p>User-Agent-based stream cipher. Pre-computed 521-byte keystream for fixed UA. 
                XOR decryption.</p>
              </div>
              <div className="provider-card">
                <h4>🎬 111movies</h4>
                <p>AES-256-CBC + XOR + Base64 + alphabet substitution. Five layers of obfuscation.</p>
              </div>
              <div className="provider-card">
                <h4>📡 Vidsrc + VidLink</h4>
                <p>AES-256-CBC decryption. Multi-language support (17 servers).</p>
              </div>
            </div>

            <h3>6.3 Case Study: DLHD January 2026 Security Update</h3>
            <p>
              On January 16, 2026, DLHD implemented Proof-of-Work authentication. On January 21, 
              they added timestamp validation requiring timestamps to be 5-10 seconds in the past.
            </p>
            <div className="challenge">
              <h4>🔐 The PoW Algorithm</h4>
              <p>
                Key requests require: <code>Authorization: Bearer &lt;jwt&gt;</code>, 
                <code>X-Key-Timestamp</code>, and <code>X-Key-Nonce</code>. The nonce must satisfy: 
                <code>MD5(hmac + resource + keyNumber + timestamp + nonce)[0:4] &lt; 0x1000</code>
              </p>
              <p className="solution">
                <strong>Our Solution:</strong> Reverse engineered the obfuscated JavaScript, extracted 
                the HMAC secret, implemented PoW computation in Cloudflare Workers. Discovered timestamp 
                must be 7 seconds in the past (middle of acceptable range).
              </p>
            </div>

            <h3>6.4 Research Metrics</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">8</span>
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
              <li>Query multiple stream providers in parallel</li>
              <li>Provider-specific decoders crack obfuscation and extract playable URLs</li>
              <li>Proxy layer handles CORS, header spoofing, and referrer manipulation</li>
              <li>Clean stream delivered to custom video player</li>
              <li>Automatic fallback to alternatives if primary source fails</li>
            </ol>

            <h3>7.2 Hybrid Anime System (January 2026)</h3>
            <p>
              TMDB for fast browsing, MAL for accurate episode data. Automatic conversion handles 
              absolute episode numbering:
            </p>
            <ul>
              <li><strong>Browse:</strong> TMDB API with Japanese origin filter</li>
              <li><strong>Details:</strong> Auto-detect anime → fetch MAL data</li>
              <li><strong>Episode Mapping:</strong> TMDB episode 48 → MAL Season 3 Episode 1</li>
              <li><strong>Streaming:</strong> AnimeKai with correct MAL ID and episode</li>
            </ul>

            <h3>7.3 The Numbers</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">80K+</span>
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

            <h3>8.3 AnimeKai Integration</h3>
            <ul>
              <li><strong>Sub/Dub Toggle:</strong> One click to switch audio tracks</li>
              <li><strong>Preference Memory:</strong> Remembers your sub/dub preference</li>
              <li><strong>Multiple Servers:</strong> Mega, Yuki, and others with automatic fallback</li>
              <li><strong>Auto-Detection:</strong> Japanese animation automatically uses AnimeKai</li>
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
                  functional streaming. Exploitative practices are profit-maximizing choices, not 
                  technical requirements.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">2</span>
                <div>
                  <h4>Zero-Cost Operation Is Achievable</h4>
                  <p>The platform runs entirely on free tiers. Vercel, Neon, Cloudflare Workers. 
                  The &quot;we need aggressive ads to pay for servers&quot; argument is demonstrably false.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">3</span>
                <div>
                  <h4>Security Through Obscurity Fails</h4>
                  <p>Every provider we analyzed—from WASM binaries to PoW systems—was eventually 
                  cracked. Obfuscation adds friction but not security.</p>
                </div>
              </div>
              <div className="finding">
                <span className="number">4</span>
                <div>
                  <h4>Solo Development Is Feasible</h4>
                  <p>One person, working part-time, can build a production-quality streaming platform 
                  with 8 providers, 850+ live channels, and hybrid anime integration.</p>
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
              search fails (e.g., JJK Season 3).</li>
            </ul>

            <h3>10.3 The Cat-and-Mouse Reality</h3>
            <p>
              Reverse engineering streaming providers is an ongoing battle. DLHD updated their 
              security twice in January 2026 alone (PoW authentication, then timestamp validation). 
              The system is architected with this reality in mind—provider-specific adapters can be 
              updated independently, and automated health checks monitor extraction success rates.
            </p>
          </section>

          {/* Future Work */}
          <section id="future">
            <h2>11. Future Work</h2>
            
            <h3>11.1 Completed Since Initial Release</h3>
            <ul>
              <li><strong>8 Providers:</strong> Vidsrc, VidLink, AnimeKai, MegaUp, Flixer, 111movies, DLHD, fallbacks</li>
              <li><strong>Live TV:</strong> 850+ channels with PoW authentication</li>
              <li><strong>Hybrid Anime:</strong> TMDB browse + MAL details with automatic episode mapping</li>
              <li><strong>Multi-Platform:</strong> Chromecast, AirPlay, TV navigation, Copy URL</li>
              <li><strong>Subtitle System:</strong> 29 languages, sync adjustment, non-UTF8 encoding</li>
            </ul>

            <h3>11.2 Still on the Roadmap</h3>
            <ul>
              <li><strong>Smart Recommendations:</strong> Privacy-preserving personalization</li>
              <li><strong>Progressive Web App:</strong> Offline capability and app-like experience</li>
              <li><strong>Internationalization:</strong> Multiple UI languages, RTL support</li>
              <li><strong>Watch Parties:</strong> Synchronized viewing with friends</li>
              <li><strong>Provider Redundancy:</strong> Continuing to expand backup providers</li>
            </ul>
          </section>

          {/* Conclusion */}
          <section id="conclusion">
            <h2>12. Conclusion: On the Feasibility of Ethical Piracy</h2>
            <p className="lead">
              We built a streaming platform. It works. It does not assault users with pop-ups, mine 
              cryptocurrency on their CPUs, or track them across the web. And we did it alone, 
              part-time, with no budget, over eight months of evenings and weekends.
            </p>
            <p>
              Eight providers cracked. 850+ live TV channels. Hybrid anime system with automatic 
              episode mapping. Chromecast, AirPlay, TV navigation, Copy URL for external players. 
              29-language subtitles with sync adjustment. All built by one person, still with no 
              budget, still without exploiting a single user.
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
            <p>
              The pirate streaming sites can no longer hide behind claims of necessity. We have 
              demonstrated that their entire business model can be replicated without the exploitation. 
              The malware is optional. The cryptocurrency mining is optional. The seventeen pop-up 
              advertisements are optional. They are choices, and those choices reveal priorities.
            </p>

            <h3>12.2 On Fighting Piracy with Piracy</h3>
            <p>
              There is a certain poetic justice in using piracy to fight piracy. The sites we reverse 
              engineer profit from content they do not own. We profit from... well, we do not profit 
              at all, which rather undermines the piracy metaphor, but the point stands.
            </p>
            <p>
              By demonstrating that their systems can be bypassed and their content accessed without 
              supporting their exploitative practices, we remove their ability to profit from stolen 
              content. If enough users choose ethical alternatives, the economics of malware-based 
              streaming become untenable.
            </p>
            <p>
              Is this piracy? Technically, yes. Is it ethical? That depends on your framework. But 
              if you accept that the original pirate sites are unethical (and they are—they serve 
              malware to users), then perhaps fighting them with their own methods has a certain 
              moral symmetry.
            </p>

            <h3>12.3 The Broader Implications</h3>
            <p>
              This project has implications beyond streaming. It demonstrates that:
            </p>
            <ul>
              <li><strong>Exploitation is a choice:</strong> Services can operate without malware, 
              tracking, or deceptive practices. The fact that many choose not to reveals their priorities.</li>
              <li><strong>Obfuscation is not security:</strong> Every protection we encountered was 
              eventually bypassed. Security through obscurity fails given sufficient motivation.</li>
              <li><strong>Solo development is viable:</strong> Modern tools and platforms enable 
              individuals to build production-quality services that would have required teams a decade ago.</li>
              <li><strong>Free tiers are generous:</strong> The economics of cloud computing have 
              shifted dramatically. Services that would have cost thousands per month can now run for free.</li>
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
              You do not have to tolerate cryptocurrency miners running on your device. You do not 
              have to navigate seventeen pop-up advertisements to watch a video.
            </p>
            <p>
              Alternatives can exist. This project is proof. Demand better from the services you use. 
              And if they refuse to provide it, build it yourself. Or use something someone else built. 
              The tools are available. The knowledge is documented. The only thing standing between 
              you and a better internet is the willingness to build it.
            </p>

            <h3>12.5 A Message to Developers</h3>
            <p>
              If you have the skills to build something, build something good. The world has enough 
              services that exploit users. It has enough dark patterns, enough deceptive interfaces, 
              enough malware disguised as legitimate software.
            </p>
            <p>
              Build something that respects users. Build something that prioritizes their experience 
              over your profit margins. Build something you would be proud to show your parents, or 
              your children, or anyone else whose opinion you value.
            </p>
            <p>
              The economics work. The technology exists. The only question is whether you choose to 
              use your skills for good or for profit. And if you can find a way to do both, even better.
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
            <p>
              To the pirate sites we reverse engineered: Thank you for the learning experience. Your 
              obfuscation techniques were educational, if ultimately futile. We hope you enjoy reading 
              about how we bypassed all of them.
            </p>
            <p>
              To the users: You deserve better than malware. We hope this helps.
            </p>
            <p>
              To the developers: Build good things. The world needs more of them.
            </p>
            <p className="signature">
              <em>- Vynx, Professional Insomniac and Occasional Pirate Hunter</em><br/>
              <em>January 2026</em>
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

            <h3>13.3 DMCA Compliance (Or: A Letter to Rights Holders)</h3>
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
                malicious advertising, cryptocurrency mining, and browser hijacking. You know, the 
                sites that are actually making money from your intellectual property.
              </p>
              <p>
                We have spent hundreds of hours reverse engineering these operations. We know how 
                they work. We know where they host their content. We know their CDN providers, their 
                obfuscation techniques, their infrastructure, and in some cases, their approximate 
                geographic locations based on server response times and TLS certificate authorities.
              </p>
              <p>
                <strong>We would be more than happy to share our findings.</strong>
              </p>
              <p>
                Your fight is with the pirate sites that are actually hosting and profiting from your 
                content. We are just documenting how their systems work. But if you would like detailed 
                technical documentation of their infrastructure, obfuscation methods, and operational 
                patterns—information that might be useful in legal proceedings or takedown efforts—we 
                are happy to provide it.
              </p>
              <p>
                Think of us as unpaid security researchers who have thoroughly documented the systems 
                you are trying to shut down. We are not your enemy. We might even be useful.
              </p>
              <p className="dmca-footer">
                <strong>Contact:</strong> If you are a legitimate rights holder seeking information 
                about pirate streaming infrastructure, we are open to discussion. If you are a pirate 
                site operator who found this page and is now concerned about how much we know about 
                your systems: Good. You should be.
              </p>
            </div>

            <h3>13.4 Privacy</h3>
            <p><strong>What We Do NOT Collect:</strong> Names, emails, addresses, phone numbers, 
            payment info, biometric data, cross-site tracking.</p>
            <p><strong>What We Do Collect:</strong> Anonymous session identifiers, aggregate usage 
            statistics, anonymized error logs for debugging.</p>

            <div className="legal-footer">
              <p><strong>Effective Date:</strong> November 2025</p>
              <p><strong>Last Updated:</strong> January 2026</p>
              <p><strong>Version:</strong> 1.2</p>
            </div>
          </section>

          {/* References */}
          <section id="references">
            <h2>14. References</h2>
            <div className="references">
              <p>[1] Rafique, M. Z., et al. (2016). It&apos;s free for a reason: Exploring the ecosystem 
              of free live streaming services. <em>NDSS</em>.</p>
              
              <p>[2] Konoth, R. K., et al. (2018). MineSweeper: An in-depth look into drive-by 
              cryptocurrency mining and its defense. <em>ACM CCS</em>.</p>
              
              <p>[3] Laperdrix, P., et al. (2020). Browser fingerprinting: A survey. <em>ACM 
              Transactions on the Web</em>, 14(2), 1-33.</p>
              
              <p>[4] Gray, C. M., et al. (2018). The dark (patterns) side of UX design. <em>CHI 
              Conference on Human Factors in Computing Systems</em>, 1-14.</p>
              
              <p>[5] DLHD January 2026 Security Update - Internal Documentation. Proof-of-Work 
              authentication with HMAC-SHA256 + MD5 nonce computation.</p>
              
              <p>[6] AnimeKai Cipher Analysis - Internal Documentation. 183-table position-dependent 
              substitution cipher reverse engineering.</p>
              
              <p>[7] Flixer WASM Cracking - Internal Documentation. Rust-compiled WebAssembly 
              analysis using Ghidra and memory forensics.</p>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
