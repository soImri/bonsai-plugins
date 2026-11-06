// Copy to scenario.mjs and adapt against the observed live UI.
// The reusable recorder has no product-specific selectors, user names or prompts.
let ownedScope;

export async function prepare({ page, expect }) {
  // Establish a dedicated sandbox chat/page and its stable locator or session identity.
  // Set ownedScope BEFORE making any change so cleanup can recover partial preparation.
  // Verify no pre-existing replies or queued messages in that scope.
  void page; void expect; void ownedScope;
  throw new Error('Adapt prepare/run/cleanup to the observed sandbox UI before recording.');
}

export async function run({ page, mark, glide, type, wait, expect, signal }) {
  // mark('task_start');
  // await type(observedComposer, "<demo task> Just reply here, don't save anything.");
  // await glide(observedSendButton);
  // mark('task_sent');
  // await expect(observedResult).toBeVisible({ timeout: 60000 });
  // mark('result');
  // await wait(2000);
  // mark('end');
  void page; void mark; void glide; void type; void wait; void expect; void signal;
  throw new Error('Implement the real flow; do not fabricate its result.');
}

export async function cleanup({ page, expect }) {
  if (!ownedScope) return; // No mutation may precede scope assignment in prepare.
  // Stop the demo-owned run, discard its queued work, and assert that both are gone.
  // Do not target every Interrupt button on the page or stop unrelated sessions.
  void page; void expect;
  throw new Error('Implement and verify cleanup for the demo-owned scope.');
}
