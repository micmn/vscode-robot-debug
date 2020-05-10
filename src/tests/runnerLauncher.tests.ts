import { RunnerLauncher } from "../runnerLauncher";
import * as path from 'path'
import * as fs from "fs-extra";
import * as tmp from "tmp";
import expect = require("expect.js");

describe('Test Runner Launcher', () => {
	const PROJECT_ROOT = path.join(__dirname, '../../');
	const RUNNER_PATH = path.join(PROJECT_ROOT, './src/tests/MockRunner.py');
	const TESTPATH = 'test.robot';

	const PORT = 5005;
	const HOSTNAME = 'localhost';

	it('Launch python test runner', (done) => {
		const {name: workDir} = tmp.dirSync();
		const runnerLauncher = new RunnerLauncher(RUNNER_PATH, PORT, HOSTNAME, TESTPATH, workDir);
		runnerLauncher.on('exit', (code) => {
			expect(code).eql(0);
			const contents = fs.readFileSync(path.join(workDir, 'args.txt'), 'utf-8');
			expect(contents).eql(`${HOSTNAME} ${PORT} ${TESTPATH}`);
			fs.removeSync(workDir);
			done();
		});
		runnerLauncher.start();
	});
})