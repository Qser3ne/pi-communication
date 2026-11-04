import { expect,it,vi } from 'vitest';
vi.mock('node:fs',async importOriginal=>({...await importOriginal<typeof import('node:fs')>(),realpathSync:(path:string)=>path==='/tmp'?'/private/tmp':path}));
import { resolvePaths } from '../../src/registry.ts';
it('canonicalizes the OS temp root before strict no-symlink checks (macOS /tmp)',()=>{
  expect(resolvePaths('/Users/test/.pi/agent').socketDir).toMatch(/^\/private\/tmp\/pi-peer-/);
});
