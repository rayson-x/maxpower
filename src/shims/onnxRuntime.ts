/**
 * Runtime loader for onnxruntime-web.
 *
 * 与 tasksVision 相同的规避方式:Metro 无法处理包内的动态 import/WASM 加载,
 * 因此把预构建的 ESM bundle 作为静态资源放到 public/vendor/,
 * 由浏览器原生 import 加载;Function 构造器把 import() 藏起来,避开 Metro 静态分析。
 * WASM 产物放在 public/ort/,通过 env.wasm.wasmPaths 指过去。
 */
export interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}

export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

export interface OrtModule {
  InferenceSession: {
    create(
      modelPath: string,
      options: { executionProviders: string[] },
    ): Promise<OrtSession>;
  };
  Tensor: new (
    type: "float32",
    data: Float32Array,
    dims: readonly number[],
  ) => unknown;
  env: {
    wasm: { wasmPaths: string; numThreads?: number };
  };
}

let modulePromise: Promise<OrtModule> | null = null;

export function loadOrt(): Promise<OrtModule> {
  if (!modulePromise) {
    const nativeImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<OrtModule>;
    modulePromise = nativeImport("/vendor/ort_bundle.mjs").then((ort) => {
      ort.env.wasm.wasmPaths = "/ort/";
      return ort;
    });
  }
  return modulePromise;
}
