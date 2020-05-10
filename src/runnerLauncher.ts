import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import { logger } from "vscode-debugadapter";
import * as Path from 'path';

export interface IRunnerLauncher extends EventEmitter {
	start();
}

export class RunnerLauncher extends EventEmitter implements IRunnerLauncher {

	private robotProcess: ChildProcess;
	private readonly executable: string = "py";

	constructor(private runnerPath: string, private port: number, private hostname: string,
				private suite: string, private workdir: string = Path.dirname(suite)) {
			super();
		}

	public start() {
		const args = ["-3", this.runnerPath, this.hostname, this.port.toString(), this.suite];
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