import * as fs from "fs";

/** Writes `data` as indented JSON with a trailing newline. */
export function writeJson(path: string, data: unknown) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function reportFailures(failedUrls:string[], totalUrlNum:number) {
    if (!failedUrls.length) {
        console.log("All URLs were successfully scanned! 🎉")
    } else {
        console.log(`${failedUrls.length} out of ${totalUrlNum} URLs failed`);
        console.log("The following URLs failed:");
        for (let url of failedUrls) {
            console.log(url);
        }
    }
}