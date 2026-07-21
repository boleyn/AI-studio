declare const Bun: any;

declare const MACRO: {
  isAnthropicInternalBuild?: boolean;
  [key: string]: any;
};

declare module "bun:test" {
  export const describe: (...args: any[]) => any;
  export const test: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const expect: (...args: any[]) => any;
  export const beforeAll: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => any;
  export const afterAll: (...args: any[]) => any;
  export const afterEach: (...args: any[]) => any;
  export const mock: (...args: any[]) => any;
  export const spyOn: (...args: any[]) => any;
}

declare module "he";
declare module "qrcode";
