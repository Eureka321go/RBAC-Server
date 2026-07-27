// 平台无关 core 只需要跨端都有的定时器全局。
// 刻意不引入 DOM lib 或 @types/node——否则 document/window/fetch/Node 专属 API 会漏进 core 且编译期不报错。
declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(handle: number): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(handle: number): void;
