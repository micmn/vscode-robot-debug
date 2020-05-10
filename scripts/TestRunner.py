import sys
import os
import socket
import json
import threading
import robot
from enum import Enum
from collections import defaultdict

class DebuggerMessage:
    TERMINATE = 'TERMINATE'
    PAUSE = 'PAUSE'
    CONTINUE = 'CONTINUE'
    STEP = 'STEP'
    STEP_IN = 'STEP_IN'
    STEP_OUT = 'STEP_OUT'
    CALL_STACK = 'CALL_STACK'
    SET_BREAKPOINTS = 'SET_BREAKPOINTS'
    CLEAR_BREAKPOINTS = 'CLEAR_BREAKPOINTS'
    VARIABLES = 'VARIABLES'

class RunnerMessage:
    CALL_STACK = 'CALL_STACK'
    SET_BREAKPOINTS = 'SET_BREAKPOINTS'
    BREAKPOINT = 'BREAKPOINT'
    STEP = 'STEP'
    STOP_ON_ENTRY = 'STOP_ON_ENTRY'

class PacketType:
    REQUEST = 'REQUEST'
    REPLY = 'REPLY'

class State(Enum):
    PAUSED = 0
    PAUSED_ON_ENTRY = 1
    RUNNING = 2
    STEP = 3
    STEP_IN = 4
    STEP_OUT = 5
    PAUSE_AT_STEP = 6

def makeRequest(req_id, msg, args={}):
    return (json.dumps({'id': req_id, 'type': PacketType.REQUEST, 'msg': msg, 'args': args})+'\n').encode('utf-8')

def makeReply(req_id, args={}):
    return (json.dumps({'id': req_id, 'type': PacketType.REPLY, 'args': args})+'\n').encode('utf-8')

def normPath(path):
    return os.path.normpath(path).lower()

class TestRunner:
    def __init__(self, host, port):
        self._logFile = open('./TestRunner.log', 'a')
        # self._logFile = sys.stderr
        self._log(host, port)
        self._install_run_suite()
        self._connect(host, port)
        self._state = State.PAUSED_ON_ENTRY
        self._pauseAtFrame = 0
        self._messages = []
        self._messageEvent = threading.Event()
        self._recvThreadObj = threading.Thread(target=self._recvThread)
        self._recvThreadObj.daemon = True
        self._recvThreadObj.start()
        self._breakpoints = defaultdict(dict)
        self._breakpointId = 0
        self._reqId = 0
        self._requests = {}
        self._runner = None
        self._callstack = []
        self._tmpFrame = None
        self._requestHandlers = {
            DebuggerMessage.PAUSE: self._onPauseRequest,
            DebuggerMessage.CONTINUE: self._onContinueRequest,
            DebuggerMessage.TERMINATE: self._onTerminateRequest,
            DebuggerMessage.STEP: self._onStepRequest,
            DebuggerMessage.STEP_IN: self._onStepInRequest,
            DebuggerMessage.STEP_OUT: self._onStepOutRequest,
            DebuggerMessage.CALL_STACK: self._onCallStackRequest,
            DebuggerMessage.SET_BREAKPOINTS: self._onSetBreakpointsRequest,
            DebuggerMessage.VARIABLES: self._onVariablesRequest,
        }
        self._request(RunnerMessage.STOP_ON_ENTRY)

    def _log(self, *args):
        print("TestRunner.py:", *args, file=self._logFile)
        self._logFile.flush()

    @property
    def state(self):
        return self._state

    @property
    def paused(self):
        return self._state == State.PAUSED or self._state == State.PAUSED_ON_ENTRY

    def _onPauseRequest(self, req_id, args):
        self._state = State.PAUSED
        self._reply(req_id)

    def _onContinueRequest(self, req_id, args):
        self._state = State.RUNNING
        self._reply(req_id)

    def _onTerminateRequest(self, req_id, args):
        self._reply(req_id)
        self.close()
        sys.exit(1)

    def _onStepRequest(self, req_id, args):
        self._reply(req_id)
        self._state = State.STEP

    def _onStepInRequest(self, req_id, args):
        self._reply(req_id)
        self._state = State.STEP_IN

    def _onStepOutRequest(self, req_id, args):
        self._reply(req_id)
        self._state = State.STEP_OUT

    def _onCallStackRequest(self, req_id, args):
        frames = []
        if self._state != State.PAUSED_ON_ENTRY:
            for index, ctx in enumerate(self._callstack):
                frames.append({'index': index+1, 'name': ctx['name'], 'file': ctx['file'], 'line': ctx['line']})
            frames.reverse()
        self._reply(req_id, {'frames': frames})

    def _onSetBreakpointsRequest(self, req_id, args):
        self._setBreakpoints(req_id, normPath(args['path']), args['lines'])

    def _onVariablesRequest(self, req_id, args):
        variables = []
        frame_id = args['frame_id']
        # scopes = [global, suite, test, frame1, frame2, frame3, ...]
        # we maintain stack entries for test, frame1, frame2, frame3, ...
        self._log("SCOPES LEN", len(self._runner._variables._scopes))
        vars_dict = self._runner._variables._scopes[1+frame_id].as_dict()
        self._log("VARS DICT", frame_id, vars_dict)
        for name in vars_dict:
            if name != '&{SUITE_METADATA}':
                variables.append({'name': name, 'value': str(vars_dict[name])})
        self._reply(req_id, {'variables': variables})

    def _recvThread(self):
        while True:
            self._log("RECV WAIT")
            try:
                line = self._input_file.readline()
                obj = json.loads(line)
            except:
                break
            self._log("RECV MESSAGE", obj)
            self._messages.append(obj)
            self._messageEvent.set()
            self._messageEvent.clear()

    def _process_messages(self):
        while len(self._messages) > 0:
            packet = self._messages.pop(0)
            self._log(packet)
            packet_type = packet['type']
            msg = packet['msg']
            req_id = packet['id']
            args = packet['args']
            if packet_type == PacketType.REQUEST:
                self._requestHandlers[msg](req_id, args)
            elif packet_type == PacketType.REPLY:
                pass # Ignore
        self._messageEvent.clear()

    def _request(self, msg, args={}, callback=None):
        req_id = self._reqId
        self._reqId += 1
        packet = makeRequest(req_id, msg, args)
        self._log(PacketType.REQUEST, packet)
        self._socket.sendall(packet)
        if callback is not None:
            self._requests[req_id] = callback

    def _reply(self, req_id, args={}):
        packet = makeReply(req_id, args)
        self._log(PacketType.REPLY, packet)
        self._socket.sendall(packet)

    def _setBreakpoints(self, req_id, path, lines):
        bps = []
        for line in lines:
            self._breakpoints[path][line] = {'id': self._breakpointId, 'verified': True, 'line': line}
            bps.append({'id': self._breakpointId, 'verified': True, 'line': line})
            self._breakpointId += 1
        self._reply(req_id, {'breakpoints': bps})

    def _connect(self, host, port):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect((host, port))
        self._socket = sock
        self._input_file = self._socket.makefile('rb')

    def _install_run_suite(self):
        def _run_suite(run_suite):
            def wrapper(obj, settings=None, **options):
                self._log("RUN SUITE", obj)
                self._install_wrappers()
                return run_suite(obj, settings, **options)
            return wrapper
        def _visit_suite(visit_suite):
            def wrapper(obj, runner):
                self._log("VISIT SUITE", obj, runner)
                self._runner = runner
                result = visit_suite(obj, runner)
                return result
            return wrapper
        robot.running.model.TestSuite.run = _run_suite(robot.running.model.TestSuite.run)
        robot.running.model.TestSuite.visit = _visit_suite(robot.running.model.TestSuite.visit)

    def _install_wrappers(self):
        robot.running.model.TestCase.visit = self._run_test(
            robot.running.model.TestCase.visit)
        robot.running.userkeywordrunner.UserKeywordRunner.run = self._run_userkeyword(
            robot.running.userkeywordrunner.UserKeywordRunner.run)
        robot.running.steprunner.StepRunner.run_step = self._run_step(
            robot.running.steprunner.StepRunner.run_step)
        robot.variables.scopes.VariableScopes.start_keyword = self._variables_start_keyword(
            robot.variables.scopes.VariableScopes.start_keyword)
        robot.variables.scopes.VariableScopes.end_keyword = self._variables_end_keyword(
            robot.variables.scopes.VariableScopes.end_keyword)
        robot.variables.scopes.VariableScopes.start_test = self._variables_start_test(
            robot.variables.scopes.VariableScopes.start_test)
        robot.variables.scopes.VariableScopes.end_test = self._variables_end_test(
            robot.variables.scopes.VariableScopes.end_test)

    @property
    def _currentFile(self):
        return self._callstack[-1]['file'] if len(self._callstack) > 0 else ''

    @property
    def _currentLine(self):
        return self._callstack[-1]['line'] if len(self._callstack) > 0 else -1

    def _check_breakpoint(self):
        self._log("CHECK BREAKPOINT", self._currentFile, self._breakpoints)
        path = normPath(self._currentFile)
        if self._currentLine in self._breakpoints[path]:
            self._state = State.PAUSED
            self._request(RunnerMessage.BREAKPOINT, {'breakpoint': self._breakpoints[path][self._currentLine]})

    def _variables_start_keyword(self, start_keyword):
        def wrapper(obj):
            self._callstack.append(self._tmpFrame)
            start_keyword(obj)
        return wrapper

    def _variables_end_keyword(self, end_keyword):
        def wrapper(obj):
            self._callstack.pop()
            end_keyword(obj)
        return wrapper

    def _variables_start_test(self, start_test):
        def wrapper(obj):
            self._callstack.append(self._tmpFrame)
            start_test(obj)
        return wrapper

    def _variables_end_test(self, end_test):
        def wrapper(obj):
            self._callstack.pop()
            end_test(obj)
        return wrapper

    def _run_step(self, run_step):
        def wrapper(obj, step, name=None):
            self._log("BEGIN RUN STEP", obj, step, step.parent.source, step.lineno)
            self._callstack[-1]['file'] = step.parent.source
            self._callstack[-1]['line'] = step.lineno
            self._check_breakpoint()
            if self._state == State.PAUSE_AT_STEP:
                self._state = State.PAUSED
                self._request(RunnerMessage.STEP)
            if self.paused:
                self._log("PAUSED AT STEP", step.parent.source, step.lineno)
            self._process_messages()
            while self.paused:
                self._messageEvent.wait()
                self._process_messages()
            stop_after_step = False
            if self._state == State.STEP:
                stop_after_step = True
                self._state = State.RUNNING
            elif self._state == State.STEP_IN:
                self._state = State.PAUSE_AT_STEP
            elif self._state == State.STEP_OUT:
                self._state = State.RUNNING
                self._pauseAtFrame = len(self._callstack)-1
            result = run_step(obj, step, name)
            if stop_after_step:
                self._state = State.PAUSED
                self._request(RunnerMessage.STEP)
            elif self._pauseAtFrame == len(self._callstack):
                self._state = State.PAUSED
                self._request(RunnerMessage.STEP)
                self._process_messages()
                while self.paused:
                    self._messageEvent.wait()
                    self._process_messages()
                if self._state == State.STEP or self._state == State.STEP_IN:
                    self._state = State.PAUSE_AT_STEP
            self._log("END RUN STEP", obj, step, step.parent.source, step.lineno)
            return result
        return wrapper

    def _run_test(self, run):
        def wrapper(obj, runner):
            self._log("BEGIN TEST", obj, obj.source, obj.lineno, runner)
            self._tmpFrame = {'file': obj.source, 'line': obj.lineno, 'name': obj.name}
            # self._check_breakpoint()
            if self.paused:
                self._log("PAUSED AT TEST", obj.source, obj.lineno, runner)
            self._process_messages()
            while self.paused:
                self._messageEvent.wait()
                self._process_messages()
            result = run(obj, runner)
            self._log("END TEST", obj, obj.source, obj.lineno)
            return result
        return wrapper

    def _run_userkeyword(self, run):
        def wrapper(obj, kw, ctx):
            self._log("BEGIN USER KEYWORD", obj, kw, kw.source, kw.lineno)
            self._tmpFrame = {'file': kw.source, 'line': kw.lineno, 'name': kw.name}
            # self._check_breakpoint()
            if self.paused:
                self._log("PAUSED AT USER KEYWORD", kw.source, kw.lineno)
            self._process_messages()
            while self.paused:
                self._messageEvent.wait()
                self._process_messages()
            result = run(obj, kw, ctx)
            self._log("END USER KEYWORD", obj, kw, kw.source, kw.lineno)
            return result
        return wrapper

    def close(self):
        self._socket.shutdown(socket.SHUT_RDWR)
        self._logFile.close()
        # self._socket.close()

if __name__ == '__main__':
    TestRunner(sys.argv[1], int(sys.argv[2]))
    rc = robot.run_cli(sys.argv[3:], False)
    TestRunner.close()
    sys.exit(rc)
