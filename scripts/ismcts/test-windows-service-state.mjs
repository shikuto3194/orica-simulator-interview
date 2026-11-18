import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import {
  createWindowsServiceReader,
  setWindowsServiceBusy,
  readWindowsServiceBusy,
} from "./windows-service-state.mjs";

export function testWindowsServiceState() {
  const state = createWindowsServiceReader();
  assert.equal(readWindowsServiceBusy(state), false);
  setWindowsServiceBusy(state, true);
  assert.equal(readWindowsServiceBusy(state), true);
  assert.equal(Object.isFrozen(state), true);
  assert.throws(() => setWindowsServiceBusy(state, "false"));
  assert.equal(readWindowsServiceBusy(state), true);
  for (const value of [
    undefined,
    null,
    {},
    () => false,
    state.bind(null),
    new Proxy(state, {}),
  ])
    assert.throws(() => readWindowsServiceBusy(value), /owned synchronous/);

  let completed = 1;
  for (const kind of [
    "ordinary",
    "constructor",
    "invalid-species",
    "throwing-species",
  ]) {
    // A separate ordinary Node process uses its default rejection policy and
    // no rejection/exception listeners. If called, each callback makes the old
    // rejection-handler repair fail before asynchronous cleanup can complete.
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import {setTimeout as delay, setImmediate as nextTurn} from 'node:timers/promises';
      import {runWindowsResourceLoop} from ${JSON.stringify(new URL("./windows-resource-loop.mjs", import.meta.url).href)};
      let invoked=0, closed=0;
      const kind=${JSON.stringify(kind)};
      const serviceBusy=()=>{
        invoked++;
        const rejected=Promise.reject(new Error('service callback rejection'));
        if(kind==='constructor') Object.defineProperty(rejected,'constructor',{get(){throw Error('constructor access');}});
        if(kind==='invalid-species') Object.defineProperty(rejected,'constructor',{value:{[Symbol.species]:{}}});
        if(kind==='throwing-species') Object.defineProperty(rejected,'constructor',{value:{get [Symbol.species](){throw Error('species access');}}});
        return rejected;
      };
      await assert.rejects(()=>runWindowsResourceLoop({
        resourceWatchdog:true,
        start:()=>assert.fail('unowned callback must not start'),
        async close(){await delay(20);closed++;}
      },{serviceBusy}),/owned synchronous/);
      await nextTurn();
      assert.equal(invoked,0);assert.equal(closed,1);
      assert.equal(process.listenerCount('unhandledRejection'),0);
      assert.equal(process.listenerCount('uncaughtException'),0);
      console.log('cleanup-complete caller-alive');
    `,
      ],
      { encoding: "utf8", timeout: 10000 }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /cleanup-complete caller-alive/);
    completed++;
  }
  return { completed, provesRuntimeAcceptance: false };
}
