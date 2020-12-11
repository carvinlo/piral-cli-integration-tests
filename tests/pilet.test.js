const path = require("path");
const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const { type } = require("os");

const { toMatchFilesystemSnapshot } = require("../src/jest-fs-snapshot");
const {
    getInitializerOptions,
    cleanDir,
    cleanupForSnapshot,
    snapshotOptions,
    waitForRunning,
    timeoutCommand,
} = require("../src/common");

const execute = promisify(exec);
const sleep = promisify(setTimeout);
expect.extend({ toMatchFilesystemSnapshot });
const fsPromises = fs.promises;
fsPromises.rm = fsPromises.rm || promisify(fs.unlink);

const srcFilePath = path.resolve(process.cwd(), "pilet", "src", "index.tsx");

const cliVersion = process.env.CLI_VERSION || "latest";
const installFlag = process.version.startsWith("v15") ? "-y --legacy-peer-deps -- " : "";

jest.setTimeout(300 * 1000); // 300 second timeout

const afterAllHandlers = [];

describe("pilet", () => {
    it("scaffold pilet", async () => {
        const pathToBuildDir = path.resolve(process.cwd(), "pilet-build");
        await cleanDir(pathToBuildDir);

        const info = await execute(`npm init pilet@${cliVersion} ${installFlag} -y`, {
            cwd: pathToBuildDir,
        });

        await cleanupForSnapshot(pathToBuildDir);

        expect(info.stderr).toBe("");

        expect(pathToBuildDir).toMatchFilesystemSnapshot(undefined, snapshotOptions);
    });

    it("pilet scaffold with piral source", async () => {
        const pathToBuildDir = path.resolve(process.cwd(), "pilet");
        await cleanDir(pathToBuildDir);

        // scaffold new pilet
        const info = await execute(
            `npm init pilet@${cliVersion} ${installFlag}--source sample-piral@${cliVersion} -y`,
            {
                cwd: pathToBuildDir,
            }
        );
        expect(info.stderr).toBe("");
    });

    it("HMR", async (done) => {
        const pathToBuildDir = path.resolve(process.cwd(), "pilet");
        const port = 38080;

        // fixing node15 issue
        if (process.version.startsWith("v15") && type().startsWith("Linux"))
            try {
                await execute(`timeout 60s npx pilet debug --port 2323`, {
                    cwd: pathToBuildDir,
                });
            } catch (error) {}

        // start the debug process and wait until compiled and server running
        const debugProcess = spawn(`${timeoutCommand} npx pilet debug --port ${port}`, {
            cwd: pathToBuildDir,
            shell: true,
        });
        afterAllHandlers.push(() => {
            debugProcess.kill("SIGTERM");
            debugProcess.stdout.destroy();
            debugProcess.stderr.destroy();
        });

        const handleError = jest.fn();
        debugProcess.stderr.once("data", handleError);
        await waitForRunning(debugProcess, port);

        // Go to page and check for expected pilet
        await page.goto(`http://localhost:${port}`, { waitUntil: "networkidle0" });
        let innerHtml = await page.$eval(".pi-tile", (element) => {
            return element.children[0].innerHTML;
        });
        expect(innerHtml).toBe("Welcome to Piral!");

        // Will be resolved 1s after the dev server has recompiled the changes
        const backendReloaded = new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Server not started after 60s")), 60 * 1000);
            debugProcess.stdout.once("data", () => {
                clearTimeout(timeout);
                resolve();
            });
        }).then(() => sleep(1000));

        // Update in src/index.tsx to trigger HMR
        const newString = `Welcome to Test${Math.floor(Math.random() * 10000)}!`;
        const indexFile = await fsPromises.readFile(srcFilePath);
        await fsPromises.writeFile(srcFilePath, indexFile.toString().replace("Welcome to Piral!", newString));

        // Wait until changes have been applied and check the updated pilet
        await backendReloaded;
        innerHtml = await page.$eval(".pi-tile", (element) => {
            return element.children[0].innerHTML;
        });
        expect(innerHtml).toBe(newString);

        // Validate, that the debug process did not output any errors and terminate the process
        expect(handleError).not.toBeCalled();
        debugProcess.kill("SIGTERM");
        debugProcess.stdout.destroy();
        debugProcess.stderr.destroy();

        done();
    });
});

afterAll(() => {
    afterAllHandlers.forEach((handler) => handler());
});
