import { IRunnerLauncher } from "../runnerLauncher";
import { EventEmitter } from "events";
import { Socket } from "net";
import { PacketType } from "../runnerConnector";
import { RunnerMessage, DebuggerMessage } from "../protocol";

export class MockRunnerLauncher extends EventEmitter implements IRunnerLauncher {
	private client: Socket;
	private connected: boolean = false;
	private reqId: number = 0;

	constructor(private port: number, private hostname: string) {
		super();
	}

	public start() {
		this.client = new Socket();
		this.client.connect(this.port, this.hostname, () => {
			this.connected = true;
			this.client.write(this.makePacket(this.reqId++, PacketType.Request, RunnerMessage.StopOnEntry));
		});
		this.client.on('data', data => {
			this.receive(data)
		})
	}

	public exit() {
		this.connected = false;
		this.sendEvent('exit');
		this.client.destroy();
	}

	public isConnected(): boolean {
		return this.connected;
	}

	public hitBreakpoint() {
		this.client.write(this.makePacket(this.reqId++, PacketType.Request, RunnerMessage.Breakpoint));
	}

	public stopOnStep() {
		this.client.write(this.makePacket(this.reqId++, PacketType.Request, RunnerMessage.Step));
	}

	public sendPacket(packet: string) {
		this.client.write(packet);
	}

	private receive(data: Buffer) {
		for (const packet of this.readPackets(data)) {
			if (packet.type === PacketType.Reply) {
			}
			else if (packet.type === PacketType.Request) {
				if (packet.msg === DebuggerMessage.Pause) {
					this.client.write(this.makePacket(packet.id, PacketType.Reply, DebuggerMessage.Pause));
				}
				else if (packet.msg === DebuggerMessage.SetBreakpoints) {
					let id = 1;
					this.client.write(this.makePacket(packet.id, PacketType.Reply, DebuggerMessage.SetBreakpoints,
						{breakpoints: packet.args.lines.map((line) => ({line, verified: true, id: id++}))}
					));
				}
			}
		}
	}

	private readPackets(data: Buffer): any[] {
		const packets = data.toString();
		return packets.split('\n').filter(x => x.length !== 0).map(x => JSON.parse(x));
	}

	public makePacket(id: number, type: PacketType, msg: DebuggerMessage | RunnerMessage, args: any = {}) {
		return JSON.stringify({id, type, msg, args})+"\n";
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}