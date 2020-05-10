import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, ContinuedEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { RunnerConnector } from './runnerConnector';
import { DebuggerMessage, RobotBreakpoint, DebuggerSetBreakpointsReply, DebuggerCallStackReply } from './protocol';
import { RunnerLauncher } from './runnerLauncher';
import * as path from 'path';
const { Subject } = require('await-notify');

// import { createWriteStream } from 'fs-extra';
// const Log = createWriteStream('C:/Users/michele.mazzoni/Desktop/Workspace/vscode-rf-debug/robot-debug.txt', {flags:'a'})

/**
 * This interface describes the robot-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the robot-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "suite" to debug. */
	suite: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
}

export class RobotDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	private static RUNNER_PATH = path.join(__dirname, './scripts/TestRunner.py');

	private runnerConnector: RunnerConnector;

	private variableHandles = new Handles<number>();

	private configurationDone = new Subject();

	// maps from sourceFile to array of Robot breakpoints
	private breakPoints = new Map<string, number[]>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("robot-debug.txt");

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// if (args.supportsProgressReporting) {
		// 	this._reportProgress = true;
		// }

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to support data breakpoints
		// response.body.supportsDataBreakpoints = true;

		// make VS Code to support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = true;

		// make VS Code send the breakpointLocations request
		// response.body.supportsBreakpointLocationsRequest = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this.configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// start the suite in the runtime
		const suite = args.suite;
		const stopOnEntry = !!args.stopOnEntry;
		logger.log(suite);

		const hostname = 'localhost';
		const port = 5544;

		this.runnerConnector = new RunnerConnector(
			new RunnerLauncher(RobotDebugSession.RUNNER_PATH, port, hostname, suite), port, hostname);

		// setup event handlers
		this.runnerConnector.on('stopOnEntry', () => {
			if (!stopOnEntry) {
				this.runnerConnector.request(DebuggerMessage.Continue);
			}
			this.sendEvent(new StoppedEvent('entry', RobotDebugSession.THREAD_ID));
		});
		this.runnerConnector.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', RobotDebugSession.THREAD_ID));
		});
		this.runnerConnector.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', RobotDebugSession.THREAD_ID));
		});
		this.runnerConnector.on('stopOnDataBreakpoint', () => {
			this.sendEvent(new StoppedEvent('data breakpoint', RobotDebugSession.THREAD_ID));
		});
		this.runnerConnector.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', RobotDebugSession.THREAD_ID));
		});
		this.runnerConnector.on('breakpointValidated', (bp: RobotBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this.runnerConnector.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);

			if (text === 'start' || text === 'startCollapsed' || text === 'end') {
				e.body.group = text;
				e.body.output = `group-${text}\n`;
			}

			e.body.source = this.createSource(filePath);
			e.body.line = this.convertDebuggerLineToClient(line);
			e.body.column = this.convertDebuggerColumnToClient(column);
			this.sendEvent(e);
		});
		this.runnerConnector.on('connected', () => {
			this.breakPoints.forEach((lines, path) => {
				this.runnerConnector.request(DebuggerMessage.SetBreakpoints, {path, lines})
					.then(args => {
						// this.sendEvent("setBreakpoints", args)
					});
			})
		});
		this.runnerConnector.on('close', () => {
			this.sendEvent(new TerminatedEvent());
		});

		this.runnerConnector.start();

		// this.verifyBreakpoints(this._sourceFile);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this.configurationDone.wait(1000);

		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		this.runnerConnector.request(DebuggerMessage.Terminate);
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		const path = <string>args.source.path;
		const breakpoints = args.breakpoints || [];

		const lines = breakpoints.map(b => this.convertClientLineToDebugger(b.line));
		this.runnerConnector.request(DebuggerMessage.SetBreakpoints, {path, lines})
			.then(({breakpoints}: DebuggerSetBreakpointsReply) => {
				const actualBreakpoints = breakpoints.map(b => {
					const bp = <DebugProtocol.Breakpoint> new Breakpoint(b.verified, this.convertDebuggerLineToClient(b.line));
					bp.id = b.id;
					return bp;
				});

				response.body = {
					breakpoints: actualBreakpoints
				};
				this.sendResponse(response);
			});
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {

		if (args.source.path) {
			const bps = this.breakPoints.get(args.source.path);
			if (bps) {
				response.body = {
					breakpoints: bps.map(col => {
						return {
							line: args.line,
							column: this.convertDebuggerColumnToClient(col)
						}
					})
				};
			}
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(RobotDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		// const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		// const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		// const endFrame = startFrame + maxLevels;

		this.runnerConnector.request(DebuggerMessage.CallStack).then(({frames}: DebuggerCallStackReply) => {
			response.body = {
				stackFrames: frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
				totalFrames: frames.length
			};
			this.sendResponse(response);
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		response.body = {
			scopes: [
				new Scope("Scope", this.variableHandles.create(args.frameId), false)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

		const frameId = this.variableHandles.get(args.variablesReference);

		this.runnerConnector.request(DebuggerMessage.Variables, {frame_id: frameId}).then(args => {
			response.body = {
				variables: args.variables.map(({name, value}) => ({name, value, variablesReference: 0}))
			};
			this.sendResponse(response);
		});
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): void {
		this.runnerConnector.request(DebuggerMessage.Pause);
		this.sendEvent(new StoppedEvent("pause"));
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.runnerConnector.request(DebuggerMessage.Continue);
		this.sendEvent(new ContinuedEvent(RobotDebugSession.THREAD_ID));
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.runnerConnector.request(DebuggerMessage.Step);
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments, request?: DebugProtocol.Request): void {
		this.runnerConnector.request(DebuggerMessage.StepIn);
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request): void {
		this.runnerConnector.request(DebuggerMessage.StepOut);
		this.sendResponse(response);
	}

	// protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		// let reply: string | undefined = undefined;

		// if (args.context === 'repl') {
		// 	// 'evaluate' supports to create and delete breakpoints from the 'repl':
		// 	const matches = /new +([0-9]+)/.exec(args.expression);
		// 	if (matches && matches.length === 2) {
		// 		const mbp = this._runtime.setBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
		// 		const bp = <DebugProtocol.Breakpoint> new Breakpoint(mbp.verified, this.convertDebuggerLineToClient(mbp.line), undefined, this.createSource(this._runtime.sourceFile));
		// 		bp.id= mbp.id;
		// 		this.sendEvent(new BreakpointEvent('new', bp));
		// 		reply = `breakpoint created`;
		// 	} else {
		// 		const matches = /del +([0-9]+)/.exec(args.expression);
		// 		if (matches && matches.length === 2) {
		// 			const mbp = this._runtime.clearBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
		// 			if (mbp) {
		// 				const bp = <DebugProtocol.Breakpoint> new Breakpoint(false);
		// 				bp.id= mbp.id;
		// 				this.sendEvent(new BreakpointEvent('removed', bp));
		// 				reply = `breakpoint deleted`;
		// 			}
		// 		} else {
		// 			const matches = /progress/.exec(args.expression);
		// 			if (matches && matches.length === 1) {
		// 				if (this._reportProgress) {
		// 					reply = `progress started`;
		// 					this.progressSequence();
		// 				} else {
		// 					reply = `frontend doesn't support progress (capability 'supportsProgressReporting' not set)`;
		// 				}
		// 			}
		// 		}
		// 	}
		// }

		// response.body = {
		// 	result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
		// 	variablesReference: 0
		// };
		// this.sendResponse(response);
	// }

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'robot-adapter-data');
	}
}
