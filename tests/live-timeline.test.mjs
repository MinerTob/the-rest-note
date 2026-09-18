import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savedPosition,savePosition,restartPosition} from '../src/lib/live-timeline.ts';
test('a switched-away track remains at its explicitly saved position',()=>{
 savePosition('paused-track',35);
 assert.equal(savedPosition('paused-track',100),35);
 assert.equal(savedPosition('paused-track',100),35);
});
test('each track keeps an independent paused position and wraps to its duration',()=>{
 savePosition('track-a',35);
 savePosition('track-b',12);
 assert.equal(savedPosition('track-a',30),5);
 assert.equal(savedPosition('track-b',30),12);
});
test('restart and invalid positions resolve safely to zero',()=>{
 savePosition('restartable',18);
 restartPosition('restartable');
 assert.equal(savedPosition('restartable',200),0);
 savePosition('invalid',NaN);
 assert.equal(savedPosition('invalid',200),0);
});
