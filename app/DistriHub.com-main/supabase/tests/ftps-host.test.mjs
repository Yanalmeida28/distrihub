import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFtpsHost } from '../../tools/resolveFtpsHost.mjs';
const ip='192.0.2.10';
test('FTPS resolves a Hostinger PTR and verifies it points to the existing server IP',async()=>{
 const dns={reverse:async address=>{assert.equal(address,ip);return ['srv123.hstgr.io'];},lookup:async(name,options)=>{assert.equal(name,'srv123.hstgr.io');assert.equal(options.all,true);return [{address:ip}];}};
 assert.equal(await resolveFtpsHost(ip,'',dns),'srv123.hstgr.io');
});
test('FTPS rejects a reverse DNS result pointing to another IP or an unrelated domain',async()=>{
 await assert.rejects(resolveFtpsHost(ip,'',{reverse:async()=>['srv123.hstgr.io'],lookup:async()=>[{address:'192.0.2.20'}]}),/No verified/);
 await assert.rejects(resolveFtpsHost(ip,'',{reverse:async()=>['unrelated.example'],lookup:async()=>{throw Error('Must not resolve');}}),/No verified/);
});
test('FTPS validates an explicit hostname against the original IP and rejects output injection',async()=>{
 assert.equal(await resolveFtpsHost(ip,'ftp.example.test',{lookup:async()=>[{address:ip}]}),'ftp.example.test');
 await assert.rejects(resolveFtpsHost(ip,'ftp.example.test',{lookup:async()=>[{address:'192.0.2.20'}]}),/No verified/);
 for(const configured of [ip,'ftp.example.test\nother=value','https://ftp.example.test'])await assert.rejects(resolveFtpsHost(ip,configured),/DNS hostname/);
});
test('existing DNS server configuration is preserved and network errors fail closed',async()=>{
 assert.equal(await resolveFtpsHost('ftp.example.test'),'ftp.example.test');
 await assert.rejects(resolveFtpsHost(ip,'',{reverse:async()=>{throw Error('DNS offline');}}),/DNS offline/);
 await assert.rejects(resolveFtpsHost('ftp.example.test/path'),/Invalid/);
});
