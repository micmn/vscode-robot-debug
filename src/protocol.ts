export enum DebuggerMessage {
	Pause = "PAUSE",
	Continue = "CONTINUE",
	Terminate = "TERMINATE",
	Step = "STEP",
	StepIn = "STEP_IN",
	StepOut = "STEP_OUT",
	CallStack = "CALL_STACK",
	SetBreakpoints = "SET_BREAKPOINTS",
	ClearBreakpoint = "CLEAR_BREAKPOINTS",
	Variables = "VARIABLES",
	Evaluate = "EVALUATE"
}

export enum RunnerMessage {
	CallStack = "CALL_STACK",
	SetBreakpoints = "SET_BREAKPOINTS",
	Breakpoint = "BREAKPOINT",
	Step = "STEP",
	StopOnEntry = "STOP_ON_ENTRY",
}

export interface RobotBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export interface DebuggerSetBreakpointsReply {
	breakpoints: RobotBreakpoint[];
}

export interface DebuggerCallStackReply {
	frames: Frame[];
}

export interface Frame {
	index: number;
	name: string;
	file: string;
	line: number;
}