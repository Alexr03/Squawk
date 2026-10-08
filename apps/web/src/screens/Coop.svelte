<script lang="ts">
  interface Props { onBack: () => void }
  let { onBack }: Props = $props();
</script>

<div class="coop">
  <header><button class="back" onclick={onBack}>← Back</button><h1>Co-op</h1></header>
  <p>Coming online: host a shift in your browser and invite friends to take seats.</p>
</div>

<style>
  .coop { height: 100vh; background: var(--bg); padding: 18px 40px; font: 14px var(--ui); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 600 21px var(--ui); color: var(--green); }
  .back { background: var(--btn); border: 1px solid var(--line); color: var(--ink-strong); font: 13px var(--ui); padding: 3px 10px; cursor: pointer; }
</style>
