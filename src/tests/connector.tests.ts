import { RunnerConnector, PacketType } from "../runnerConnector";
// import * as path from 'path';
// import { DebuggerMessage } from "../protocol";
// import * as fs from "fs-extra";
// import * as tmp from "tmp";
import expect = require("expect.js");
import { DebuggerMessage, DebuggerSetBreakpointsReply, RunnerMessage } from "../protocol";
import { MockRunnerLauncher } from "./mockRunnerLauncher";

describe('Test Runner Connector', () => {

	const PORT = 5005;
	const HOSTNAME = 'localhost';
	let mockRunner: MockRunnerLauncher;
	let connector: RunnerConnector;

	afterEach('Close mock runner', () => {
		if (mockRunner.isConnected()) {
			mockRunner.exit();
		}
	});

	it('Connect to test runner', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let connected = false;
		connector.on('connected', () => {
			expect(connector.isConnected()).ok();
			connected = true;
			mockRunner.exit();
		})
		connector.on('close', () => {
			expect(connected).ok();
			done();
		});
		connector.start();
	});

	it('Send request without arguments', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let reply = false;
		connector.on('connected', () => {
			connector.request(DebuggerMessage.Pause).then(() => {
				reply = true;
				mockRunner.exit();
			});
		})
		connector.on('close', () => {
			expect(reply).ok();
			done();
		});
		connector.start();
	});

	it('Send request with arguments', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let reply = false;
		connector.on('connected', () => {
			connector.request(DebuggerMessage.SetBreakpoints,
				{'path': '/path/to/file', 'lines': [1, 4, 10]}).then((args: DebuggerSetBreakpointsReply) => {
					reply = true;
					expect(args.breakpoints).eql([
						{id: 1, line: 1, verified: true},
						{id: 2, line: 4, verified: true},
						{id: 3, line: 10, verified: true}
					]);
					mockRunner.exit();
			});
		})
		connector.on('close', () => {
			expect(reply).ok();
			done();
		});
		connector.start();
	});

	it('Receive reply with wrong id', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		connector.on('connected', () => {
			mockRunner.sendPacket(
				JSON.stringify({id: 1000, type: PacketType.Reply, msg: DebuggerMessage.Continue, args: {}})+"\n");
		})
		connector.on('error', (error) => {
			expect(error.message).eql("Received reply to unknown request");
			done();
		});
		connector.start();
	});

	it('Receive reply with wrong packet type', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		connector.on('connected', () => {
			mockRunner.sendPacket(
				JSON.stringify({id: 0, type: "#?!", msg: RunnerMessage.Breakpoint, args: {}})+"\n");
		})
		connector.on('error', (error) => {
			expect(error.message).eql("Received unknown packet type");
			done();
		});
		connector.start();
	});

	it('Receive unkown request', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		connector.on('connected', () => {
			mockRunner.sendPacket(
				JSON.stringify({id: 0, type: PacketType.Request, msg: "!@#$", args: {}})+"\n");
		})
		connector.on('error', (error) => {
			expect(error.message).eql("Received unknown request");
			done();
		});
		connector.start();
	});

	it('Send request before runner is connected', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let reply = false;
		connector.on('close', () => {
			expect(reply).ok();
			done();
		});
		connector.request(DebuggerMessage.Pause).then(() => {
			reply = true;
			mockRunner.exit();
		});
		connector.start();
	});

	it('Receive stop on breakpoint request from runner', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let received = false;
		connector.on('connected', () => {
			mockRunner.hitBreakpoint();
		})
		connector.on('close', () => {
			expect(received).ok();
			done();
		});
		connector.on('stopOnBreakpoint', () => {
			received = true;
			mockRunner.exit();
		});
		connector.start();
	});

	it('Receive stop on step request from runner', done => {
		mockRunner = new MockRunnerLauncher(PORT, HOSTNAME);
		connector = new RunnerConnector(mockRunner, PORT, HOSTNAME);
		let received = false;
		connector.on('connected', () => {
			mockRunner.stopOnStep();
		})
		connector.on('close', () => {
			expect(received).ok();
			done();
		});
		connector.on('stopOnStep', () => {
			received = true;
			mockRunner.exit();
		});
		connector.start();
	});

	// const PROJECT_ROOT = path.join(__dirname, '../../');
	// const RUNNER_PATH = path.join(PROJECT_ROOT, './bin/TestRunner.py');
	// const DATA_ROOT = path.join(PROJECT_ROOT, 'src/tests/data/');

	// let workdir: string;
	// let connector: RunnerConnector;

	// beforeEach('Create temporary working directory and runner connection', () => {
	// 	const {name} = tmp.dirSync();
	// 	workdir = name;
	// 	connector = new RunnerConnector(new MockRunnerLauncher(), PORT, HOSTNAME);
	// });

	// afterEach('Remove temporary working directory', () => {
	// 	fs.remove(workdir);
	// });

	// it('Run a robot test', done => {
	// 	connector.start();
	// 	connector.on('connected', () => {
	// 		expect(connector.isConnected()).to.be.ok();
	// 		connector.request(DebuggerMessage.Continue);
	// 	})
	// 	connector.on('close', () => {
	// 		const contents = fs.readFileSync(path.join(DATA_ROOT, 'output.xml'), 'utf-8');
	// 		expect(contents).not.to.contain('status="FAIL"')
	// 		done();
	// 	});
	// });
});