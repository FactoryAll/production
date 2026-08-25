const { ROLE_PERMISSIONS, getAttributeRole } = require('/app/packages/contracts/dist/access.js');

console.log('ADM perms:', ROLE_PERMISSIONS['ADM']?.slice(0, 5));
console.log('Has dashboard:read:', ROLE_PERMISSIONS['ADM']?.includes('dashboard:read'));
console.log('getAttributeRole result:', getAttributeRole(['ADM'], 'dashboard:read'));
