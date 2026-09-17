const D=require('../src/difficulty.js');

// Read-only content audit: target scores and practice labels are not evidence.
function audit(campaign, {analyze=D.analyze,minDrop=12}={}) {
  if(!campaign||!Array.isArray(campaign.levels)||!campaign.levels.length)throw new Error('campaign levels required');
  if(!Number.isFinite(minDrop)||minDrop<0)throw new Error('minDrop must be nonnegative');
  const issues=[],rows=[],byNumber=new Map(),ids=new Set();
  const add=(level,code,severity,detail)=>issues.push({level,code,severity,detail});
  for(const record of campaign.levels){
    if(!Number.isInteger(record.level)||record.level<1||byNumber.has(record.level))throw new Error('invalid or duplicate level number');
    if(typeof record.puzzleId!=='string'||!record.puzzleId||ids.has(record.puzzleId))throw new Error('invalid or duplicate puzzleId');
    ids.add(record.puzzleId);
    const report=analyze(record.puzzle,{budgetMs:10000,maxStates:1000});
    const row={level:record.level,puzzleId:record.puzzleId,targetScore:record.targetScore,recoveryOfLevel:record.recoveryOfLevel??null,status:report.status};
    if(report.status!=='accepted')add(record.level,'analysis-not-accepted','error',report.stage||report.reason||report.status);
    else {
      Object.assign(row,{actualScore:report.difficultyScore,analyzerVersion:report.analyzerVersion,profile:report.profile});
      if(record.targetScore!==row.actualScore)add(record.level,'configured-score-mismatch','warning',{configured:record.targetScore,actual:row.actualScore});
      if(record.level>=9&&report.profile.singletonCount>0)add(record.level,'late-singleton','error',report.profile.singletonCount);
    }
    rows.push(row);byNumber.set(record.level,row);
  }
  const recoveries=[];
  for(const row of rows){
    if(row.recoveryOfLevel===null)continue;
    const source=byNumber.get(row.recoveryOfLevel);
    if(!source||source.level>=row.level){add(row.level,'invalid-recovery-source','error',row.recoveryOfLevel);continue;}
    if(source.level!==row.level-1)add(row.level,'nonadjacent-recovery','warning',source.level);
    if(source.status!=='accepted'||row.status!=='accepted')continue;
    const drop=source.actualScore-row.actualScore;
    const load={};
    for(const key of ['proofDepth','premiseCount','workUnits','focusRegionCount','span'])load[key]={before:source.profile[key],after:row.profile[key]};
    const practicedSubsets=source.profile.subsetSizes.filter(k=>row.profile.subsetSizes.includes(k));
    const repeatedRules=source.profile.rules.filter(rule=>row.profile.rules.includes(rule)&&!['single','placed-exclusion'].includes(rule));
    recoveries.push({from:source.level,to:row.level,scoreDrop:drop,load,practicedSubsets,repeatedRules});
    if(drop<=0)add(row.level,'recovery-not-easier','error',{from:source.level,scoreDrop:drop});
    else if(drop<minDrop)add(row.level,'small-recovery-drop','warning',{from:source.level,scoreDrop:drop,minDrop});
    if(source.profile.subsetSizes.length&&!practicedSubsets.length)add(row.level,'subset-practice-not-observed','warning',{from:source.level,requiredSizes:source.profile.subsetSizes});
    if(!repeatedRules.length)add(row.level,'shared-practice-not-observed','warning',{from:source.level});
  }
  return {campaignVersion:campaign.campaignVersion,status:issues.some(x=>x.severity==='error')?'needs-correction':'review',
    boundary:'Engineering screening only; actual player calibration remains required.',minDrop,rows,recoveries,issues};
}
if(require.main===module){
  const result=audit(require('../data/campaign.js'));
  console.log(JSON.stringify(result,null,2));
  if(result.status==='needs-correction')process.exitCode=1;
}
module.exports={audit};
