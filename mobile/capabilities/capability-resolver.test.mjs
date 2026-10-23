import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_FEATURES } from './feature-catalog.ts';
import { lookupFeature, resolveFeature, resolveAllFeatures } from './capability-resolver.ts';
import { SevenFeatureDispatcher, FeatureUnavailableError } from './feature-dispatcher.ts';

const env = (overrides = {}) => ({
  platform: 'android',
  localConfirmed: [],
  workspaceTrusted: true,
  remote: { connected: false, authenticated: false, capabilities: [] },
  ...overrides
});

test('every VS Code feature has one unique coverage requirement', () => {
  assert.ok(ALL_FEATURES.length >= 75);
  assert.equal(new Set(ALL_FEATURES.map(f => f.id)).size, ALL_FEATURES.length);
  const areas = new Set(ALL_FEATURES.map(f => f.area));
  for (const area of ['editor','files','terminal','git','debug','testing',
    'extensions','notebooks','preview','ai','settings','dev','collaboration']) {
    assert.ok(areas.has(area), 'missing '+area);
  }
});

test('no runtime flags means no feature is silently marked functional', () => {
  for (const platform of ['android','ios']) {
    const all = resolveAllFeatures(env({platform}));
    assert.equal(all.length, ALL_FEATURES.length);
    assert.equal(all.filter(f => f.status === 'available').length, 0);
  }
});

test('Android local PTY capability is distinct from confirmed build tools', () => {
  const android = env({localConfirmed:['terminal.shell']});
  assert.deepEqual(resolveFeature(lookupFeature('terminal.shell'),android).target,'local');
  assert.equal(resolveFeature(lookupFeature('dev.build'),android).status,'requires-connection');
  assert.equal(resolveFeature(lookupFeature('debug.launch'),android).status,'requires-connection');
});

test('iOS does not silently claim a general native PTY', () => {
  const ios = env({platform:'ios',localConfirmed:['terminal.shell','terminal.iosEmbeddedCommands']});
  assert.notEqual(resolveFeature(lookupFeature('terminal.shell'),ios).status,'available');
  assert.equal(resolveFeature(lookupFeature('terminal.iosEmbeddedCommands'),ios).target,'local');
});

test('remote capabilities require authentication and connectivity', () => {
  const caps = ['debug.launch','extensions.nodeHost','dev.build','git.pullPush'];
  const feature = lookupFeature('debug.launch');
  assert.equal(resolveFeature(feature,env({remote:{connected:true,authenticated:false,capabilities:caps}})).status,'requires-connection');
  assert.equal(resolveFeature(feature,env({remote:{connected:true,authenticated:true,capabilities:caps}})).target,'remote');
  assert.equal(resolveFeature(lookupFeature('notebooks.kernel'),env({remote:{connected:true,authenticated:true,capabilities:caps}})).status,'requires-integration');
});

test('workspace trust blocks execution even with remote attached', () => {
  const result=resolveFeature(lookupFeature('terminal.tasks'),env({
    workspaceTrusted:false,
    remote:{connected:true,authenticated:true,capabilities:['terminal.tasks']}
  }));
  assert.equal(result.status,'workspace-untrusted');
});

test('dispatcher routes only verified capability to explicit executor', async () => {
  const calls=[];
  const e=env({
    remote:{connected:true,authenticated:true,capabilities:['debug.launch']}
  });
  const d=new SevenFeatureDispatcher(()=>e,{
    remote:{execute:async req=>{calls.push(req);return {running:true};}}
  });
  const request={featureId:'debug.launch',operation:'start',payload:{configuration:'test'}};
  const answer=await d.execute(request);
  assert.equal(answer.target,'remote');
  assert.deepEqual(answer.result,{running:true});
  assert.equal(calls.length,1);
  await assert.rejects(d.execute({...request,featureId:'git.clone'}),FeatureUnavailableError);
  assert.equal(calls.length,1);
});

test('dispatcher rejects unregistered operations and missing executor', async () => {
  const d=new SevenFeatureDispatcher(()=>env({localConfirmed:['editor.text']}),{});
  await assert.rejects(d.execute({featureId:'editor.text',operation:'open',payload:{}}),FeatureUnavailableError);
  await assert.rejects(d.execute({featureId:';',operation:'open',payload:{}}),TypeError);
  await assert.rejects(d.execute({featureId:'editor.text',operation:'',payload:{}}),TypeError);
});
