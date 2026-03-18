/**
 * Hexa/Flixer WASM Compatibility Checker
 *
 * Compiles a new WASM binary and compares its exports/imports against the
 * expected interface to determine if it's safe to auto-deploy.
 *
 * Requirements: REQ-WASM-2.1, REQ-WASM-2.2, REQ-WASM-2.3
 */

export interface WasmCompatReport {
  compatible: boolean;
  exportsDiff: { added: string[]; removed: string[]; unchanged: string[] };
  importsDiff: { added: string[]; removed: string[]; unchanged: string[] };
  timestamp: number;
}

/**
 * Expected exports from the current WASM binary.
 * These are the function/memory names the import shim relies on.
 */
export const EXPECTED_EXPORTS: string[] = [
  'get_img_key',
  'process_img_data',
  'memory',
  '__wbindgen_malloc',
  '__wbindgen_realloc',
  '__wbindgen_free',
  '__wbindgen_export_0',
];

/**
 * Expected imports (wbg module functions) the WASM binary requires.
 * Used for import-side compatibility checking.
 */
export const EXPECTED_IMPORTS: string[] = [
  '__wbindgen_throw',
  '__wbindgen_object_drop_ref',
];

/**
 * Compute the diff between an expected set and an actual set of names.
 */
export function computeDiff(
  expected: string[],
  actual: string[],
): { added: string[]; removed: string[]; unchanged: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const added = actual.filter(name => !expectedSet.has(name)).sort();
  const removed = expected.filter(name => !actualSet.has(name)).sort();
  const unchanged = expected.filter(name => actualSet.has(name)).sort();

  return { added, removed, unchanged };
}

/**
 * Check if a new WASM binary is compatible with the current import shim.
 *
 * Compiles the WASM module, extracts its exports and imports, then compares
 * against the expected interface. Returns a compatibility report.
 *
 * Compatible = all expected exports are present (new exports are fine).
 */
export async function checkWasmCompatibility(
  wasmBytes: ArrayBuffer,
): Promise<WasmCompatReport> {
  const timestamp = Date.now();

  let module: WebAssembly.Module;
  try {
    module = await WebAssembly.compile(wasmBytes);
  } catch (err) {
    // Compilation failure → incompatible
    return {
      compatible: false,
      exportsDiff: { added: [], removed: [...EXPECTED_EXPORTS], unchanged: [] },
      importsDiff: { added: [], removed: [...EXPECTED_IMPORTS], unchanged: [] },
      timestamp,
    };
  }

  const actualExports = WebAssembly.Module.exports(module).map(e => e.name);
  const actualImports = WebAssembly.Module.imports(module).map(i => i.name);

  const exportsDiff = computeDiff(EXPECTED_EXPORTS, actualExports);
  const importsDiff = computeDiff(EXPECTED_IMPORTS, actualImports);

  // Compatible if no expected exports are missing
  const compatible = exportsDiff.removed.length === 0;

  return { compatible, exportsDiff, importsDiff, timestamp };
}
