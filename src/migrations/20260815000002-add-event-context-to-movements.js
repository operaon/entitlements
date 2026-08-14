module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = 'entitlement_movements';
    const columns = await queryInterface.describeTable(table);
    const addColumn = async (name, definition) => {
      if (!columns[name]) await queryInterface.addColumn(table, name, definition);
    };

    await addColumn('eventId', { type: Sequelize.STRING(220), allowNull: true });
    await addColumn('correlationId', { type: Sequelize.STRING(220), allowNull: true });
    await addColumn('sourceSystem', { type: Sequelize.STRING(80), allowNull: true });
    await addColumn('sourceId', { type: Sequelize.STRING(160), allowNull: true });

    await queryInterface.addIndex(table, ['eventId'], {
      unique: true,
      name: 'entitlement_movements_event_id_unique',
    }).catch(() => {});
    await queryInterface.addIndex(table, ['correlationId'], {
      name: 'entitlement_movements_correlation_id_idx',
    }).catch(() => {});
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('entitlement_movements', 'entitlement_movements_correlation_id_idx').catch(() => {});
    await queryInterface.removeIndex('entitlement_movements', 'entitlement_movements_event_id_unique').catch(() => {});
    for (const column of ['sourceId', 'sourceSystem', 'correlationId', 'eventId']) {
      await queryInterface.removeColumn('entitlement_movements', column).catch(() => {});
    }
  },
};

