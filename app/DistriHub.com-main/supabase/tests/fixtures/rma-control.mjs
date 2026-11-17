import { businessTimeHelpers } from './business-time.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../../node_modules/typescript/lib/typescript.js';
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const cash = {};
vm.runInNewContext(compile(await readFile(new URL('../../../src/lib/cashRegister.ts', import.meta.url), 'utf8')), { exports: cash, Intl, Date, require:()=>businessTimeHelpers });
export const rmaControlExports = {};
vm.runInNewContext(compile(await readFile(new URL('../../../src/lib/rmaControl.ts', import.meta.url), 'utf8')), { exports: rmaControlExports, require: () => cash });
