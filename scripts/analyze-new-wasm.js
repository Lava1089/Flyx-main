const fs = require('fs');
const path = require('path');

async function analyzeWasm() {
  const wasmPath = path.join(__dirname, '../cloudflare-proxy/src/flixer-new.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  console.log('=== WASM File Analysis ===');
  console.log(`File size: ${wasmBuffer.length} bytes`);
  
  // Check WASM magic number
  const magic = wasmBuffer.slice(0, 4).toString('hex');
  console.log(`Magic number: ${magic} (should be 0061736d for WASM)`);
  
  // Compile and instantiate with minimal imports
  try {
    const module = await WebAssembly.compile(wasmBuffer);
    
    console.log('\n=== EXPORTS ===');
    const exports = WebAssembly.Module.exports(module);
    exports.forEach(exp => {
      console.log(`  ${exp.kind}: ${exp.name}`);
    });
    
    console.log('\n=== IMPORTS ===');
    const imports = WebAssembly.Module.imports(module);
    imports.forEach(imp => {
      console.log(`  ${imp.module}.${imp.name} (${imp.kind})`);
    });
    
    console.log(`\nTotal exports: ${exports.length}`);
    console.log(`Total imports: ${imports.length}`);
    
    // Group imports by module
    const importsByModule = {};
    imports.forEach(imp => {
      if (!importsByModule[imp.module]) {
        importsByModule[imp.module] = [];
      }
      importsByModule[imp.module].push(imp);
    });
    
    console.log('\n=== IMPORTS BY MODULE ===');
    Object.keys(importsByModule).forEach(mod => {
      console.log(`\n${mod}:`);
      importsByModule[mod].forEach(imp => {
        console.log(`  - ${imp.name} (${imp.kind})`);
      });
    });
    
  } catch (e) {
    console.error('Error analyzing WASM:', e.message);
  }
}

analyzeWasm();
