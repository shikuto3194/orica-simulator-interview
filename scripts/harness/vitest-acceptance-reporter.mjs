import { JsonReporter } from "vitest/reporters";

// Keep Vitest's JSON format and normal retry behavior. Its built-in reporter
// omits retryCount, so bind the runner's count to the complete test identity.
export default class AcceptanceJsonReporter extends JsonReporter {
  constructor(options = {}) {
    super(options);
  }

  async logTasks(files, coverageMap) {
    this.retries = new Map();
    const visit = (file, tasks, ancestors = []) => {
      for (const task of tasks) {
        if (task.type === "suite") {
          visit(file, task.tasks, [...ancestors, task.name]);
        } else if (task.type === "test") {
          const key = JSON.stringify([file, ...ancestors, task.name]);
          const counts = this.retries.get(key) || [];
          counts.push(task.result?.retryCount);
          this.retries.set(key, counts);
        }
      }
    };
    for (const file of files) visit(file.filepath, file.tasks);
    await super.logTasks(files, coverageMap);
  }

  async writeReport(raw) {
    const report = JSON.parse(raw);
    for (const file of report.testResults) {
      for (const test of file.assertionResults) {
        const key = JSON.stringify([
          file.name,
          ...test.ancestorTitles,
          test.title,
        ]);
        const counts = this.retries.get(key);
        // Missing or ambiguous runner information must never imply no retries.
        test.retryCount = counts?.length === 1 ? (counts[0] ?? null) : null;
      }
    }
    await super.writeReport(JSON.stringify(report));
  }
}
