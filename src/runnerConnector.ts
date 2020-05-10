import { EventEmitter } from "events";
import { Socket, Server, createServer } from "net";
import { DebuggerMessage, RunnerMessage } from "./protocol";
import { logger } from "vscode-debugadapter";
import { IRunnerLauncher } from "./runnerLauncher";

export enum PacketType {
	Request = "REQUEST",
	Reply = "REPLY",
}

export interface IRunnerConnector extends EventEmitter {
	start(): void;
	isConnected(): boolean;
	request(msg: DebuggerMessage, args?: any): Promise<any>;
}

export class RunnerConnector extends EventEmitter implements IRunnerConnector {

	private server: Server;
	private socket: Socket;
	private requests: Map<number, (any) => void> = new Map();
	private reqId = 0;
	private connected: boolean = false;
	private packetQueue: string[] = [];

	constructor(private runnerLauncher: IRunnerLauncher, private port: number, private hostname: string) {
		super();
	}

	public request(msg: DebuggerMessage, args: any = {}): Promise<any> {
		return new Promise<any>((resolve, reject) => {
			const id = this.reqId++;
			const packet = this.makePacket(id, PacketType.Request, msg, args);
			this.requests.set(id, resolve);
			if (this.isConnected()) {
				logger.log('RUNNER WRITE: ' + packet);
				this.socket.write(packet);
			}
			else {
				this.packetQueue.push(packet);
			}
		});
	}

	public isConnected(): boolean {
		return this.connected;
	}

	private makePacket(id: number, type: PacketType, msg: DebuggerMessage, args: any) {
		return JSON.stringify({id, type, msg, args})+"\n";
	}

	private readPackets(data: Buffer): any[] {
		const packets = data.toString();
		return packets.split('\n').filter(x => x.length !== 0).map(x => JSON.parse(x));
	}

	private receive(data: Buffer) {
		for (const packet of this.readPackets(data)) {
			logger.log('RUNNER RECEIVE: ' + packet.toString());
			if (packet.type === PacketType.Reply) {
				const resolve = this.requests.get(packet.id);
				if (resolve) {
					resolve(packet.args);
					this.requests.delete(packet.id);
				}
				else {
					this.sendEvent('error', Error("Received reply to unknown request"));
				}
			}
			else if (packet.type === PacketType.Request) {
				if (packet.msg === RunnerMessage.Breakpoint) {
					this.sendEvent('stopOnBreakpoint');
				}
				else if (packet.msg === RunnerMessage.Step) {
					this.sendEvent('stopOnStep');
				}
				else if (packet.msg === RunnerMessage.StopOnEntry) {
					this.sendEvent('stopOnEntry');
				}
				else {
					this.sendEvent('error', Error("Received unknown request"));
				}
			}
			else {
				this.sendEvent('error', Error("Received unknown packet type"));
			}
		}
	}

	public start() {
		this.server = createServer();
		this.server.listen(this.port, this.hostname);
		this.server.on('connection', socket => {
			this.socket = socket;
			this.connected = true;
			this.socket.on("error", err => {
				// FIXME: this should not be needed (runner should wait before exiting?)
				if (!('code' in err) || err['code'] !== 'ECONNRESET') {
					throw err;
				}
			})
			socket.on('data', data => this.receive(data));
			this.sendEvent('connected');
			for (const packet of this.packetQueue) {
				logger.log('RUNNER WRITE: ' + packet);
				this.socket.write(packet);
			}
			this.packetQueue = [];
		});

		this.runnerLauncher.on("exit", () => this.close());
		this.runnerLauncher.start()
	}

	private close() {
		this.socket.destroy();
		this.server.close();
		this.connected = false;
		this.sendEvent('close');
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}