
import { getAdapter } from '../app/lib/db/adapter';

async function main() {
    console.log('Starting DB verification...');

    try {
        // Test 1: Get adapter
        console.log('Testing getAdapter()...');
        const adapter = getAdapter();
        console.log('✓ getAdapter() returned successfully', !!adapter);

        // Test 2: Health check
        console.log('Testing health check...');
        const health = await adapter.healthCheck();
        console.log('✓ Health check result:', health);

        console.log('Verification complete!');
        process.exit(0);
    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
}

main();
