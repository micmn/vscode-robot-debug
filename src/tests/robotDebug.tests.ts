import {DebugClient} from 'vscode-debugadapter-testsupport';
import expect = require("expect.js");
import * as path from 'path';
// import { BreakpointEvent } from 'vscode-debugadapter';
// import * as fs from "fs-extra";
// import * as tmp from "tmp";

describe('Test Robot Debug Adapter', () => {
	const DEBUG_ADAPTER = './out/debugAdapter.js';
	const THREAD_ID = 1;

	const PROJECT_ROOT = path.join(__dirname, '../../');
	// const RUNNER_PATH = path.join(PROJECT_ROOT, './bin/TestRunner.py');
	const DATA_ROOT = path.join(PROJECT_ROOT, 'src/tests/data/');

	let dc: DebugClient;

	async function waitForStop(line: number, source: string, reason: string) {
		let bpResponse = await dc.waitForEvent('stopped');
		expect(bpResponse.body.reason).eql(reason);
		let stackResponse = await dc.stackTraceRequest({threadId: THREAD_ID});
		expect(stackResponse.body.stackFrames[0].line).eql(line);
		expect(stackResponse.body.stackFrames[0].source!.path).eql(source);
		return stackResponse.body.stackFrames;
	}

	beforeEach('Start Debug Client', () => {
		dc = new DebugClient('node', DEBUG_ADAPTER, 'node');
		dc.start();
	});

	afterEach('Stop Debug Client', () => {
		dc.stop();
	});

	it('Initialize session', done => {
		dc.initializeRequest().then(response => {
			response.body = response.body || {};
			expect(response.body.supportsConfigurationDoneRequest).ok();
			done();
		});
	});

	it('Run robot test and wait stop on entry', async () => {
		const robotTest = path.join(DATA_ROOT, 'Run_robot_test_and_wait_stop_on_entry.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
	});

	it('Run robot test to the end', done => {
		const robotTest = path.join(DATA_ROOT, 'Run_robot_test_to_the_end.robot');
		Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest }),
			dc.waitForEvent('terminated')
		]).then(() => done());
	});

	it('Start robot test and then disconnect', done => {
		const robotTest = path.join(DATA_ROOT, 'Start_robot_test_and_then_disconnect.robot');
		Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]).then(() => {
			Promise.all([
				dc.disconnectRequest(),
				dc.waitForEvent('terminated')
			]).then(() => done());
		});
	});

	it('Set and hit two breakpoints', async () => {
		const robotTest = path.join(DATA_ROOT, 'Set_and_hit_two_breakpoints.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 8}, {line: 14}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(14, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			dc.waitForEvent('terminated')
		]);
	});

	it('Set and hit two breakpoints in different files', async () => {
		const robotTest = path.join(DATA_ROOT, 'Set_and_hit_two_breakpoints_in_different_files.robot');
		const robotTestAux = path.join(DATA_ROOT, 'Set_and_hit_two_breakpoints_in_different_files_aux.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 8}]
		});
		await dc.setBreakpointsRequest({
			source: {path: robotTestAux},
			breakpoints: [{line: 9}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(9, robotTestAux, 'breakpoint')
		]);

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			dc.waitForEvent('terminated')
		]);
	});

	it('Pause and continue test', async () => {
		const robotTest = path.join(DATA_ROOT, 'Pause_and_continue_test.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);

		await dc.continueRequest({threadId: THREAD_ID});
		await Promise.all([
			dc.pauseRequest({threadId: THREAD_ID}),
			dc.waitForEvent('stopped')
		]);
		await dc.continueRequest({threadId: THREAD_ID});
		await dc.waitForEvent('terminated');
	});

	it('Check variables values', async () => {
		const robotTest = path.join(DATA_ROOT, 'Check_variables_values.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 13}]
		});

		let [,stackFrames] = await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(13, robotTest, 'breakpoint')
		]);

		let scopesResponse = await dc.scopesRequest({frameId: stackFrames[0].id});
		let varsResponse = await dc.variablesRequest({variablesReference: scopesResponse.body.scopes[0].variablesReference});

		const testVars = [
			{name: '${aaa}', value: 'Value'},
			{name: '${bbb}', value: 'BBB'},
			{name: '${var}', value: 'Value'},
			{name: '${TEST_NAME}', value: 'A Simple Test Case'},
		];
		testVars.forEach(testVar => {
			const variables = varsResponse.body.variables.filter(v => v.name === testVar.name);
			expect(variables).length(1);
			expect(variables[0].value).eql(testVar.value);
		});
	});

	it('Evaluate variables values on hover', async () => {
		const robotTest = path.join(DATA_ROOT, 'Evaluate_variables_values.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 11}, {line: 18}]
		});

		let [,stackFrames] = await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(11, robotTest, 'breakpoint')
		]);

		let response = await dc.evaluateRequest({
			expression: 'random_str',
			frameId: stackFrames[0].id,
			context: 'hover'
		});
		const randomStrValue = response.body.result;

		[,stackFrames] = await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(18, robotTest, 'breakpoint')
		]);

		response = await dc.evaluateRequest({
			expression: 'aaa',
			frameId: stackFrames[0].id,
			context: 'hover'
		});
		expect(response.body.result).eql(randomStrValue);

		response = await dc.evaluateRequest({
			expression: 'list',
			frameId: stackFrames[0].id,
			context: 'hover'
		});
		expect(response.body.result).eql(`[${randomStrValue}, "Value", "CCC", "ABC"]`);
	});

	it('Step over keyword', async () => {
		const robotTest = path.join(DATA_ROOT, 'Steps_tests.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 8}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.nextRequest({threadId: THREAD_ID}),
			waitForStop(9, robotTest, 'step')
		]);
	});

	it('Step in keyword', async () => {
		const robotTest = path.join(DATA_ROOT, 'Steps_tests.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 8}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.stepInRequest({threadId: THREAD_ID}),
			waitForStop(15, robotTest, 'step')
		]);
	});

	it('Step out keyword', async () => {
		const robotTest = path.join(DATA_ROOT, 'Steps_tests.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 15}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(15, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.stepOutRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'step')
		]);
	});

	it('Step out two keywords', async () => {
		const robotTest = path.join(DATA_ROOT, 'Steps_tests.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 23}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(23, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.stepOutRequest({threadId: THREAD_ID}),
			waitForStop(17, robotTest, 'step')
		]);

		await Promise.all([
			dc.stepOutRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'step')
		]);
	});

	it('Step in/over/out keyword', async () => {
		const robotTest = path.join(DATA_ROOT, 'Steps_tests.robot');
		await Promise.all([
			dc.configurationSequence(),
			dc.launch({ suite: robotTest, stopOnEntry: true }),
			dc.waitForEvent('stopped')
		]);
		await dc.setBreakpointsRequest({
			source: {path: robotTest},
			breakpoints: [{line: 8}]
		});

		await Promise.all([
			dc.continueRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'breakpoint')
		]);

		await Promise.all([
			dc.stepInRequest({threadId: THREAD_ID}),
			waitForStop(15, robotTest, 'step')
		]);

		await Promise.all([
			dc.nextRequest({threadId: THREAD_ID}),
			waitForStop(16, robotTest, 'step')
		]);

		await Promise.all([
			dc.stepOutRequest({threadId: THREAD_ID}),
			waitForStop(8, robotTest, 'step')
		]);
	});
});