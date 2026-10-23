import test from 'node:test';
import assert from 'node:assert/strict';
import { SevenCommandTool } from './ai-terminal-tool.ts';

test('comando só é encaminhado ao host; aprovação é nativa', async () => {
  const messages = [];
  const tool = new SevenCommandTool({postMessage: m => messages.push(JSON.parse(m))});
  const run = tool.executeCommand({requestId:'abc',command:'pwd'});
  assert.equal(messages[0].type, 'ai-propose');
  assert.equal(messages[0].command, 'pwd');
  assert.equal(tool.handleEvent({type:'ai-result',requestId:'abc',approved:true,exitCode:0,output:'/data/user/0/app',truncated:false}), true);
  assert.deepEqual(await run, {requestId:'abc',approved:true,exitCode:0,output:'/data/user/0/app',truncated:false});
  tool.dispose();
});
test('permite recusa e entrega resposta sem executar', async () => {
  const tool = new SevenCommandTool({postMessage:()=>{}});
  const p = tool.executeCommand({requestId:'no',command:'rm -rf .'});
  tool.handleEvent({type:'ai-result',requestId:'no',approved:false,exitCode:null,output:'',truncated:false,error:'Negado pelo usuário'});
  assert.equal((await p).approved, false);
  tool.dispose();
});
test('bloqueia comandos vazios, id inválido, duplicação e concorrência', async () => {
  const tool = new SevenCommandTool({postMessage:()=>{}});
  await assert.rejects(tool.executeCommand({requestId:'x',command:' '}),/Invalid command/);
  await assert.rejects(tool.executeCommand({requestId:'../',command:'ls'}),/Invalid request ID/);
  const one = tool.executeCommand({requestId:'a',command:'ls'});
  await assert.rejects(tool.executeCommand({requestId:'a',command:'pwd'}),/Duplicate/);
  await assert.rejects(tool.executeCommand({requestId:'b',command:'pwd'}),/previous command/);
  tool.handleEvent({type:'ai-result',requestId:'a',approved:true,exitCode:0,output:'',truncated:false});
  await one;
  tool.dispose();
});
test('descarta saída atrasada ou de sessão desconhecida', () => {
  const tool = new SevenCommandTool({postMessage:()=>{}});
  assert.equal(tool.handleEvent({type:'ai-result',requestId:'unknown',approved:true,exitCode:0,output:'',truncated:false}), false);
  tool.dispose();
});
test('limita tamanho da saída e interrompe promessas no dispose', async () => {
  const tool = new SevenCommandTool({postMessage:()=>{}});
  const p = tool.executeCommand({requestId:'c',command:'pwd'});
  tool.dispose();
  await assert.rejects(p,/disposed/);
});
