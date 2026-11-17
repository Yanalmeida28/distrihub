import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../../../node_modules/typescript/lib/typescript.js';
export const businessTimeHelpers = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../../src/lib/adminDashboard.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {exports:businessTimeHelpers, Date, Intl});
