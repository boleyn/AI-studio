/** 仅识别精确回环地址；不会把局域网、域名后缀或任意 DNS 解析结果当作本机。 */
export const isLocalDeviceLoopbackUrl = (url: URL) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
