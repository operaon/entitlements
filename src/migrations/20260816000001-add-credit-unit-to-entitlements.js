'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = await queryInterface.describeTable('entitlements');
    if (!table.creditUnit) {
      await queryInterface.addColumn('entitlements', 'creditUnit', {
        type: Sequelize.ENUM('SESSION'),
        allowNull: false,
        defaultValue: 'SESSION',
      });
    }
  },

  down: async (queryInterface) => {
    const table = await queryInterface.describeTable('entitlements');
    if (table.creditUnit) {
      await queryInterface.removeColumn('entitlements', 'creditUnit');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_entitlements_creditUnit";');
  },
};
