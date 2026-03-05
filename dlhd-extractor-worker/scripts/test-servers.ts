/**
 * DLHD Server Compatibility Test
 * 
 * Tests which servers work for which channels to understand
 * if servers are interchangeable or channel-specific.
 * 
 * SECURITY NOTE: This is a development-only script. Server names and domains
 * discovered here are confidential infrastructure details.
 * 
 * Run with: npx ts-node scripts/test-servers.ts
 * Or: bun run scripts/test-servers.ts
 */

const ALL_SERVERS = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];
const ALL_DOMAINS = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];

// Sample channels from different server mappings
// Use different variable name to avoid conflict with test-players.ts
const SERVER_TEST_CHANNELS = [
  // From ddy6
  { id: 40, primaryServer: 'ddy6' },
  { id: 55, primaryServer: 'ddy6' },
  { id: 100, primaryServer: 'ddy6' },
  // From zeko  
  { id: 51, primaryServer: 'zeko' },
  { id: 36, primaryServer: 'zeko' },
  { id: 81, primaryServer: 'zeko' },
  // From wind
  { id: 43, primaryServer: 'wind' },
  { id: 70, primaryServer: 'wind' },
  { id: 87, primaryServer: 'wind' },
  // From dokko1
  { id: 65, primaryServer: 'dokko1' },
  { id: 97, primaryServer: 'dokko1' },
  { id: 130, primaryServer: 'dokko1' },
  // From nfs
  { id: 1, primaryServer: 'nfs' },
  { id: 4, primaryServer: 'nfs' },
  { id: 31, primaryServer: 'nfs' },
  // From wiki
  { id: 439, primaryServer: 'wiki' },
  { id: 440, primaryServer: 'wiki' },
];

interface TestResult {
  channelId: number;
  primaryServer: string;
  results: {
    server: string;
    domain: string;
    works: boolean;
    status?: number;
    error?: string;
    responseTime?: number;
  }[];
}

async function testChannel(channelId: number, primaryServer: string): Promise<TestResult> {
  const channelKey = `premium${channelId}`;
  const results: TestResult['results'] = [];

  console.log(`\nTesting channel ${channelId} (primary: ${primaryServer})...`);

  for (const server of ALL_SERVERS) {
    for (const domain of ALL_DOMAINS) {
      const m3u8Url = `https://${server}new.${domain}/${server}/${channelKey}/mono.css`;
      const start = Date.now();
      
      try {
        const response = await fetch(m3u8Url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Referer': 'https://hitsplay.fun/',
            'Origin': 'https://hitsplay.fun',
          },
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        const responseTime = Date.now() - start;
        const text = await response.text();
        const isValidM3u8 = text.includes('#EXTM3U') || text.includes('#EXT-X-');

        results.push({
          server,
          domain,
          works: response.ok && isValidM3u8,
          status: response.status,
          responseTime,
        });

        const icon = response.ok && isValidM3u8 ? '✅' : '❌';
        console.log(`  ${icon} ${server}.${domain}: ${response.status} (${responseTime}ms)`);
      } catch (error) {
        const responseTime = Date.now() - start;
        results.push({
          server,
          domain,
          works: false,
          error: error instanceof Error ? error.message : String(error),
          responseTime,
        });
        console.log(`  ❌ ${server}.${domain}: ERROR - ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return { channelId, primaryServer, results };
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('DLHD Server Compatibility Test');
  console.log('⚠️  SECURITY: Do not share output - contains infrastructure details');
  console.log('='.repeat(60));
  console.log(`Testing ${SERVER_TEST_CHANNELS.length} channels across ${ALL_SERVERS.length} servers and ${ALL_DOMAINS.length} domains`);
  console.log(`Total combinations per channel: ${ALL_SERVERS.length * ALL_DOMAINS.length}`);

  const allResults: TestResult[] = [];

  for (const channel of SERVER_TEST_CHANNELS) {
    const result = await testChannel(channel.id, channel.primaryServer);
    allResults.push(result);
    
    // Small delay between channels to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Analyze results
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS');
  console.log('='.repeat(60));

  // Per-server success rate
  const serverStats: Record<string, { total: number; success: number }> = {};
  const domainStats: Record<string, { total: number; success: number }> = {};
  const crossServerSuccess: { channelId: number; primaryServer: string; workingServers: string[] }[] = [];

  for (const result of allResults) {
    const workingServers = new Set<string>();
    
    for (const r of result.results) {
      // Server stats
      if (!serverStats[r.server]) {
        serverStats[r.server] = { total: 0, success: 0 };
      }
      serverStats[r.server].total++;
      if (r.works) {
        serverStats[r.server].success++;
        workingServers.add(r.server);
      }

      // Domain stats
      if (!domainStats[r.domain]) {
        domainStats[r.domain] = { total: 0, success: 0 };
      }
      domainStats[r.domain].total++;
      if (r.works) domainStats[r.domain].success++;
    }

    crossServerSuccess.push({
      channelId: result.channelId,
      primaryServer: result.primaryServer,
      workingServers: Array.from(workingServers),
    });
  }

  console.log('\nServer Success Rates:');
  for (const [server, stats] of Object.entries(serverStats)) {
    const rate = ((stats.success / stats.total) * 100).toFixed(1);
    console.log(`  ${server}: ${stats.success}/${stats.total} (${rate}%)`);
  }

  console.log('\nDomain Success Rates:');
  for (const [domain, stats] of Object.entries(domainStats)) {
    const rate = ((stats.success / stats.total) * 100).toFixed(1);
    console.log(`  ${domain}: ${stats.success}/${stats.total} (${rate}%)`);
  }

  console.log('\nCross-Server Compatibility:');
  for (const item of crossServerSuccess) {
    const otherServers = item.workingServers.filter(s => s !== item.primaryServer);
    if (otherServers.length > 0) {
      console.log(`  Channel ${item.channelId} (primary: ${item.primaryServer}): Also works on ${otherServers.join(', ')}`);
    } else if (item.workingServers.length === 0) {
      console.log(`  Channel ${item.channelId} (primary: ${item.primaryServer}): NO SERVERS WORKING!`);
    } else {
      console.log(`  Channel ${item.channelId} (primary: ${item.primaryServer}): Only works on primary`);
    }
  }

  // Summary
  const channelsWithMultipleServers = crossServerSuccess.filter(c => c.workingServers.length > 1).length;
  const channelsWithOnlyPrimary = crossServerSuccess.filter(c => c.workingServers.length === 1).length;
  const channelsWithNoServers = crossServerSuccess.filter(c => c.workingServers.length === 0).length;

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Channels with multiple working servers: ${channelsWithMultipleServers}/${SERVER_TEST_CHANNELS.length}`);
  console.log(`Channels with only primary server: ${channelsWithOnlyPrimary}/${SERVER_TEST_CHANNELS.length}`);
  console.log(`Channels with no working servers: ${channelsWithNoServers}/${SERVER_TEST_CHANNELS.length}`);

  // Return results for further processing
  return allResults;
}

// Run the tests
runTests().catch(console.error);
