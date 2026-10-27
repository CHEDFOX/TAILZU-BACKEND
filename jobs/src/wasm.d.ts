// A .wasm file imported in a Worker is the compiled module (wrangler's CompiledWasm rule), not bytes.
declare module "*.wasm" {
  const compiled: WebAssembly.Module;
  export default compiled;
}
