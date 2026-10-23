/* @flow */

import { send, on, once } from "../src";

on("sendMessageToParent", ({ data }) => {
  return send(window.opener || window.parent, data.messageName, data.data).then(
    (event) => event.data
  );
});

on("setupListener", ({ data }) => {
  once(data.messageName, () => {
    return data.handler ? data.handler() : data.data;
  });
});

on("waitForMessage", ({ data }) => {
  return once(data.messageName, () => {
    return data.handler ? data.handler() : data.data;
  }).then((event) => event.data);
});

on("provideFunction", () => {
  return {
    myfunction: (val) => val * 2,
  };
});

on("callFunction", ({ data }) => {
  return data.fireAndForget
    ? data.fn.fireAndForget(...data.args)
    : data.fn(...data.args);
});

on("callFunctionFromWindow", ({ data }) => {
  return send(data.win, data.messageName).then((event) => {
    const fn = event.data[data.functionName];
    return data.fireAndForget
      ? fn.fireAndForget(...data.args)
      : fn(...data.args);
  });
});

window.addEventListener("error", () => {
  // pass
});
