const path = require("path");
const { exec, spawn } = require("child_process");
const { type } = require("os");
const fs = require("fs");

const { toMatchFilesystemSnapshot } = require("../src/jest-fs-snapshot");

const fsPromises = fs.promises;

const {
    cleanDir,
    cleanupForSnapshot,
    getInitializerOptions,
    execute,
    snapshotOptions,
    waitForRunning,
    timeoutCommand,
    sleep,
} = require("../src/common");

expect.extend({ toMatchFilesystemSnapshot });

const cliVersion = process.env.CLI_VERSION || "latest";
// const bundlerPrefix = !!process.env.BUNDLER ? process.env.BUNDLER + "-" : "";

jest.setTimeout(300 * 1000); // 60 second timeout

const afterAllHandlers = [];

describe("piral", () => {
    it("scaffold piral", async () => {
        const pathToBuildDir = path.resolve(process.cwd(), "piral-inst");

        await cleanDir(pathToBuildDir);

        const info = await execute(`npm init piral-instance@${cliVersion} ` + getInitializerOptions(), {
            cwd: pathToBuildDir,
        });

        await cleanupForSnapshot(pathToBuildDir);

        expect(info.stderr).toBe("");

        expect(pathToBuildDir).toMatchFilesystemSnapshot(undefined, snapshotOptions);
    });

    it("HMR", async (done) => {
        const pathToBuildDir = path.resolve(process.cwd(), "piral-inst");
        const layoutFilePath = path.resolve(pathToBuildDir, "src", "layout.tsx");
        const port = 38082;

        await cleanDir(pathToBuildDir);

        const info = await execute(`npm init piral-instance@${cliVersion} ` + getInitializerOptions(), {
            cwd: pathToBuildDir,
        });

        // fixing node15 issue
        if (process.version.startsWith("v15") && type().startsWith("Linux"))
            try {
                await execute(`timeout 60s npx piral debug --port 2323`, {
                    cwd: pathToBuildDir,
                });
            } catch (error) {}

        const debugProcess = spawn(`${timeoutCommand} npx piral debug --port ${port}`, {
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
        await page.goto(`http://localhost:${port}`, { waitUntil: "networkidle2" });
        await sleep(5 * 1000);

        let innerHtml = await page.$eval("h1", (element) => {
            return element.innerHTML;
        });
        expect(innerHtml).toBe("Hello, world!");

        const backendReloaded = new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Server not started after 60s")), 60 * 1000);
            debugProcess.stdout.once("data", () => {
                clearTimeout(timeout);
                resolve();
            });
        }).then(() => sleep(5000));

        const newString = `Hello, Test${Math.floor(Math.random() * 10000)}!`;
        const layoutFile = await fsPromises.readFile(layoutFilePath);
        await fsPromises.writeFile(layoutFilePath, layoutFile.toString().replace("Hello, world!", newString));

        await backendReloaded;
        innerHtml = await page.$eval("h1", (element) => {
            return element.innerHTML;
        });
        expect(innerHtml).toBe(newString);

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
