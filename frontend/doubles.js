(() => {
  const $ = id => document.getElementById(id);
  const status = $('doubles-status');
  const details = $('doubles-details');
  const online = $('doubles-online');
  const invites = $('doubles-invites');
  const busyMessage = $('doubles-message');
  let me = null;
  let lastMatch = null;
  let working = false;
  let lastStatus = '';
  const safe = value => document.createTextNode(String(value));
  const show = (el, visible) => {el.hidden = !visible;};
  const button = (text, action, style = 'btn-outline-success') => {
    const b = document.createElement('button');
    b.className = `btn ${style} btn-sm me-2 mb-2`;
    b.type = 'button';b.textContent=text;
    b.addEventListener('click', () => action());
    return b;
  };
  const request = async (path, method='GET', body) => {
    const response = await fetch(`/doubles${path}`, {
      method, credentials:'same-origin',cache:'no-store',
      headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };
  async function act(path,body) {
    if (working) return;
    working=true;
    try {
      const result=await request(path,'POST',body);
      busyMessage.textContent=JSON.stringify(result);
      await refresh();
      if(result.status==='completed') {
        const leaderboardReload = typeof loadLeaderboard === 'function' ? loadLeaderboard : null;
        if(leaderboardReload) leaderboardReload();
      }
    } catch(e) {busyMessage.textContent=e.message;}
    finally {working=false;}
  }
  function renderMatch(match) {
    details.replaceChildren();
    const heading=document.createElement('h3');heading.className='h6';heading.textContent=`Match #${match.id} · ${match.status}`;
    details.append(heading);
    for(const team of [1,2]) {
      const p=document.createElement('p');p.className='mb-2';
      p.append(safe(`Team ${team}: `));
      p.append(safe(match.players.filter(x=>x.team===team).map(p=>`${p.name} (${p.rating})`).join(' + ')));
      details.append(p);
    }
    const myself=match.players.find(p=>String(p.id)===String(me.id));
    const submitter=match.players.find(p=>String(p.id)===String(match.submitted_by));
    if(match.status==='active') {
      details.append(button('I Won',()=>act(`/matches/${match.id}/result`,{result:'win'}),'btn-success'));
      details.append(button('I Lost',()=>act(`/matches/${match.id}/result`,{result:'loss'}),'btn-outline-secondary'));
    } else if(match.status==='pending_confirmation') {
      const p=document.createElement('p');
      p.textContent=`Reported winner: Team ${match.proposed_winning_team}. Waiting for opposing team confirmation.`;
      details.append(p);
      if (submitter && myself && submitter.team !== myself.team) {
        details.append(button('Confirm result',()=>act(`/matches/${match.id}/confirm`,{decision:'confirm'}),'btn-success'));
        details.append(button('Dispute result',()=>act(`/matches/${match.id}/confirm`,{decision:'dispute'}),'btn-outline-danger'));
      }
    }
  }
  function renderInviteList(items) {
    invites.replaceChildren();
    if(!items.length) return;
    const title=document.createElement('p');title.className='mb-1';title.textContent='Duo invitations:';invites.append(title);
    for(const item of items) {
      const line=document.createElement('div');line.className='mb-2';
      line.append(safe(`${item.inviter_name} invited you. `));
      line.append(button('Accept',()=>act(`/invites/${item.id}/respond`,{decision:'accept'}),'btn-success'));
      line.append(button('Decline',()=>act(`/invites/${item.id}/respond`,{decision:'decline'}),'btn-outline-danger'));
      invites.append(line);
    }
  }
  async function refresh() {
    try {
      const session=await fetch('/auth/session',{credentials:'same-origin',cache:'no-store'});
      if (!session.ok) {
        me=null;status.textContent='Sign in to join a ranked doubles match.';
        show($('doubles-actions'),false);details.replaceChildren();online.replaceChildren();invites.replaceChildren();return;
      }
      me=await session.json();
      await request('/presence','POST');
      const data=await request('/status');
      status.textContent=data.status==='matched' ? 'Match found!' :
        data.status==='waiting' ? `Searching for opponents (${data.mode})...` :
        (data.outgoing?.length ? `Invitation sent to ${data.outgoing[0].invitee_name}, awaiting acceptance.` : 'Ready to play doubles.');
      show($('doubles-actions'),data.status==='idle' && !(data.outgoing?.length));
      show($('doubles-cancel'),data.status==='waiting');
      if (data.match) renderMatch(data.match);else details.replaceChildren();
      renderInviteList(data.invitations||[]);
      if (data.status==='idle' && !(data.outgoing?.length)) {
        const people=await request('/online');
        online.replaceChildren();
        const choose=document.createElement('select');choose.className='form-select mb-2';choose.id='doubles-person';
        const initial=document.createElement('option');initial.value='';initial.textContent='Choose an online teammate';choose.append(initial);
        for(const player of people){const op=document.createElement('option');op.value=player.id;op.textContent=`${player.display_name} (${player.rating})`;choose.append(op);}
        online.append(choose);
        online.append(button('Invite to Duo Queue',()=>{
          if(choose.value) act('/invites',{inviteeId:choose.value});
          else busyMessage.textContent='Choose an online teammate first.';
        }));
      } else online.replaceChildren();
      if(data.status!==lastStatus && data.status==='matched') {
        busyMessage.textContent='All four players matched. Play your doubles game!';
      }
      if(lastStatus==='matched' && data.status==='idle') {
        busyMessage.textContent='Your previous match is complete. Rankings have been refreshed.';
        if(typeof loadLeaderboard === 'function') loadLeaderboard();
        const message=document.getElementById('sign-in-message');
        if(message && me) message.textContent=`Signed in as ${me.display_name}. Rating: ${me.rating}.`;
      }
      lastStatus=data.status;
    } catch(e) {status.textContent=`Could not load queue: ${e.message}`;}
  }
  $('doubles-solo').addEventListener('click',()=>act('/queue/solo'));
  $('doubles-cancel').addEventListener('click',()=>act('/queue/cancel'));
  refresh();setInterval(refresh,10000);
})();
