import unittest
from unittest import mock
from unittest.mock import patch
import socket
import json
import TestRunner

class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.hostname, self.port = 'localhost', 5005
        self.module_mock = mock.Mock()
        self.socket_mock = mock.Mock()
        self.file_mock = mock.Mock()
        self.module_mock.return_value = self.socket_mock
        self.socket_mock.makefile.return_value = self.file_mock
        self.socket_patcher = patch('TestRunner.socket.socket', new=self.module_mock)
        self.socket_patcher.start()

    def tearDown(self):
        self.socket_patcher.stop()

    def test_runner_initialization(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        self.module_mock.assert_called_once_with(socket.AF_INET, socket.SOCK_STREAM)
        self.socket_mock.connect.assert_called_once_with((self.hostname, self.port))
        self.socket_mock.sendall.assert_called_once_with(
            TestRunner.makeRequest(0, TestRunner.RunnerMessage.STOP_ON_ENTRY))
        self.assertTrue(runner.paused)

    def test_continue_request(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        runner._onContinueRequest(0, {})
        self.assertEqual(runner.state, TestRunner.State.RUNNING)
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))

    def test_pause_request(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        runner._onContinueRequest(0, {})
        runner._onPauseRequest(1, {})
        self.assertEqual(runner.state, TestRunner.State.PAUSED)
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(1))

    def test_terminate_request(self):
        exit_mock = mock.Mock()
        with patch('sys.exit', new=exit_mock):
            runner = TestRunner.TestRunner(self.hostname, self.port)
            runner._onTerminateRequest(0, {})
            self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))
            exit_mock.assert_called_once_with(1)

    def test_step_request(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        runner._onStepRequest(0, {})
        self.assertEqual(runner.state, TestRunner.State.STEP)
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))

    def test_step_in_request(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        runner._onStepInRequest(0, {})
        self.assertEqual(runner.state, TestRunner.State.STEP_IN)
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))

    def test_step_out_request(self):
        runner = TestRunner.TestRunner(self.hostname, self.port)
        runner._onStepOutRequest(0, {})
        self.assertEqual(runner.state, TestRunner.State.STEP_OUT)
        self.socket_mock.sendall.assert_any_call(TestRunner.makeReply(0))



if __name__ == '__main__':
    unittest.main()