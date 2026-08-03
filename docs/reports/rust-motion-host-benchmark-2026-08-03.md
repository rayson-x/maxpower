# Rust Motion SDK Host Benchmark

范围：PC Web V1 的 Rust host 计算路径；不代表浏览器 MediaPipe、移动端温升或持续降频表现。

运行环境：Apple M4 / arm64，release profile。复现命令：

```bash
npm run benchmark:rust-motion
```

每条路径独立执行 50,000 次：

| 路径 | 总耗时 | 单次均值 | 吞吐 |
|---|---:|---:|---:|
| Canonical continuity core（33 点） | 1110.546 ms | 22.211 µs | 45,022.9 ops/s |
| Sealed-rep reference matcher（32 节点 × 11 特征） | 1240.597 ms | 24.812 µs | 40,303.2 ops/s |

这是可重复的微基准，用来分离 Rust core 与 sealed-rep matcher；真实 PC Web 的 MediaPipe、WASM core、decode、render、record 与 packet age 仍由控制台分别采样。单次 release 运行不是 P50/P95 分布，也不能外推 Android/iOS 性能。
