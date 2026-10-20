export default {
  description: "Read-only Railway access for the current Topic, scoped to the Control Plane's configured workspace. Inspect workspace/projects/services, service instance settings, recent deployments, and bounded deployment logs. Mutating Railway operations and secret values are not exposed. The Railway token never leaves the Control Plane.",
  args: {
    action: {type:"string", enum:["workspace","projects","project","service-instance","deployments","logs"]},
    projectId: {type:"string"},
    serviceId: {type:"string"},
    environmentId: {type:"string"},
    deploymentId: {type:"string"},
    limit: {type:"number"}
  },
  async execute(args, context) {
    const response = await fetch("http://127.0.0.1:4098/control", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action:"railway.tool", sessionId:context.sessionID, payload:args})
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true)
      throw new Error("Railway capability rejected. Confirm Control Plane Railway setup and the selected workspace.");
    return JSON.stringify(result.result, null, 2);
  }
};
