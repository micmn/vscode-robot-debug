import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import { logger } from "vscode-debugadapter";
import * as Path from 'path';
import * as os from 'os';

export interface IRunnerLauncher extends EventEmitter {
	start();
}

export class RunnerLauncher extends EventEmitter implements IRunnerLauncher {

	private robotProcess: ChildProcess;
	private executable: string;
	private executableArgs: string[] = [];

	constructor(private runnerPath: string, private port: number, private hostname: string,
				private stopOnEntry: boolean, private suite: string,
				private workdir: string = Path.dirname(suite)) {
			super();
			if (os.platform() === 'win32') {
				this.executable = 'py';
				this.executableArgs = ['-3'];
			}
			else {
				this.executable = 'python3'
			}
		}

	public start() {
		const stopOnEntry = this.stopOnEntry ? "stop" : "run";
		const args = [
			...this.executableArgs, this.runnerPath, this.hostname,
			this.port.toString(), stopOnEntry, this.suite
		];
		logger.log(`Spawning child process ${this.executable} ${args.toString()} with working directory ${this.workdir}`);
		this.robotProcess = spawn(this.executable, args, {
			cwd: this.workdir
		});
		this.robotProcess.stderr.on('data', data => {
			logger.log(data.toString());
		});
		this.robotProcess.on("exit",  (code, signal)=> {
			this.sendEvent('exit', code);
		});
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}