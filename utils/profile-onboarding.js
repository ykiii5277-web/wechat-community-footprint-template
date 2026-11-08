const EDITOR = 'pages/profile/intro-editor';
function required(profile, isNewUser = false) {
  return !!profile && (profile.profileCompleted === false || isNewUser && profile.profileCompleted !== true);
}
function route(page) { return String(page && page.route || '').replace(/^\/+/, '').split('?')[0]; }
module.exports = { EDITOR, required, route };
