import test from 'node:test';
import assert from 'node:assert/strict';
import { SevenWorkspaceClient } from './seven-workspace-client.ts';
import { SevenFeatureDispatcher } from '../capabilities/feature-dispatcher.ts';

class FakeSocket {
  handlers = new Map();
  sent = [];
  isClosed = false;
  addEventListener(kind, cb) {
    if (!this.handlers.has(kind)) this.handlers.set(kind, []);
    this.handlers.get(kind).push(cb);
  }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.isClosed = true; }
  emit(kind, data) { for (const cb of this.handlers.get(kind) ?? []) cb({data}); }
  open() { this.emit('open'); }
  message(message) { this.emit('message', JSON.stringify(message)); }
}

const create = () => {
  const fake = new FakeSocket();
  const client = new SevenWorkspaceClient('wss://ide.example.com/workspace', 'my-workspace', () => fake);
  return { fake, client };
};
const ready = async (caps = ['git.status','debug.launch']) => {
  const {fake,client} = create();
  const opening = client.connect('ephemeral-bearer-token');
  fake.open();
  assert.equal(fake.sent[0].type, 'session.open');
  assert.equal(fake.sent[0].workspaceId, 'my-workspace');
  fake.message({type:'session.ready',protocol:1,workspaceId:'my-workspace',
    authenticated:true,capabilities:caps});
  await opening;
  return {fake,client};
};

test('remote capabilities are not enabled before a verified authenticated handshake', async () => {
  const {fake,client} = create();
  assert.deepEqual(client.state.capabilities,[]);
  const opening = client.connect('token');
  fake.open();
  fake.message({type:'session.ready',protocol:1,workspaceId:'another-workspace',
    authenticated:true,capabilities:['debug.launch']});
  await assert.rejects(opening,/authorize/);
  assert.equal(client.state.connected,false);
});

test('remote handshake filters unsupported or unregistered feature claims', async () => {
  const {client} = await ready(['git.status','not.in.catalog','terminal.iosEmbeddedCommands']);
  assert.deepEqual(client.state.capabilities,['git.status']);
  assert.equal(client.state.authenticated,true);
  client.disconnect();
  assert.equal(client.state.connected,false);
});

test('authorized Git operations are forwarded to remote workspace', async () => {
  const {fake,client} = await ready();
  const d=new SevenFeatureDispatcher(()=>({
    platform:'android', localConfirmed:[],workspaceTrusted:true,remote:client.state
  }),{remote:client});
  const p=d.execute({featureId:'git.status',operation:'read',payload:{}});
  const request=fake.sent.at(-1);
  assert.equal(request.type,'feature.execute');
  assert.equal(request.featureId,'git.status');
  fake.message({type:'feature.result',requestId:request.requestId,ok:true,result:{clean:false}});
  assert.deepEqual(await p,{target:'remote',result:{clean:false}});
  await assert.rejects(d.execute({featureId:'dev.build',operation:'start',payload:{}}),/runtime|environment|workspace/i);
  client.disconnect();
});

test('failed operations and dropped connections are explicitly rejected', async () => {
  const {fake,client} = await ready();
  const p=client.execute({featureId:'debug.launch',operation:'start',payload:{}});
  fake.message({type:'feature.result',requestId:fake.sent.at(-1).requestId,ok:false,error:'No debugger'});
  await assert.rejects(p,/No debugger/);
  const pending=client.execute({featureId:'debug.launch',operation:'start',payload:{}});
  fake.emit('close');
  await assert.rejects(pending,/closed/);
  assert.deepEqual(client.state.capabilities,[]);
});

test('rejects token in endpoint URL or insecure transport', () => {
  assert.throws(()=>new SevenWorkspaceClient('ws://example.com','id',()=>new FakeSocket()),/wss/);
  assert.throws(()=>new SevenWorkspaceClient('wss://example.com?token=abc','id',()=>new FakeSocket()),/wss/);
});
