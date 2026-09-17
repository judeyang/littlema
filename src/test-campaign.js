(function(root){
  'use strict';
  const selected=()=>((root.location.hash||'').match(/(?:^|[#&])pack=(four|four-pair)(?:&|$)/)||[])[1];
  const testing=selected();
  root.addEventListener('hashchange',()=>{if(selected()!==testing)root.location.reload();});
  if(!testing)return;
  const paired=testing==='four-pair';
  root.GameCampaign=paired?root.FourRegionPairCampaign:root.FourRegionTestCampaign;
  root.ProgressStore=root.ProgressStore.create(paired?'pony-run-four-pair-test-v12':'pony-run-four-test-v12');
  document.title=paired?'小马快跑 · 四区域挑战与回落试玩':'小马快跑 · 四区域独立试玩';
})(window);
