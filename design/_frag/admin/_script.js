
function pkSt(s,b){document.querySelectorAll('[data-state]').forEach(function(e){var l=e.getAttribute('data-state').split('|');e.style.display=l.indexOf(s)>-1?'':'none'});document.querySelectorAll('.pkmeta .stbtn').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-s')===s)});}
function pkTheme(){var h=document.documentElement;h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'':'dark');}
document.addEventListener('DOMContentLoaded',function(){var f=document.querySelector('.pkmeta .stbtn');if(f)pkSt(f.getAttribute('data-s'),f);});

