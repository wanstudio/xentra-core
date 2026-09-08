/**
 * Template #01 - Seed Dine-in Layout Specification
 *
 * Canvas: 380x620 (normalized coordinate grid)
 * Sections:
 *   - Indoor (AC, No Smoking):
 *       - Mushola (non-table zone)
 *       - Meja 11 (8 seats)
 *       - Meja 10 (4 seats)
 *       - Meja 9 (4 seats)
 *       - Meja 8 (8 seats)
 *       - Meja 7 (8 seats)
 *       - Meja 6 (4 seats)
 *   - Outdoor / Smoking:
 *       - Meja 2 (4 seats)
 *       - Meja 1 (4 seats)
 *       - Meja 3 (4 seats)
 *       - Meja 4 (4 seats)
 *       - Meja 5 (8 seats, vertical)
 */

const TEMPLATE_01 = {
  id: 'template_01',
  name: 'Template #01 Standard Dine-in Layout',
  description: 'Indoor AC & No-Smoking area with Mushola + Smoking Outdoor area',
  canvas: {
    width: 380,
    height: 620
  },
  sections: [
    {
      id: 'sec_indoor',
      name: 'Indoor Area',
      ac: true,
      smoking: false,
      bounds: { x: 10, y: 10, width: 360, height: 355 }
    },
    {
      id: 'sec_smoking',
      name: 'Smoking Area',
      ac: false,
      smoking: true,
      bounds: { x: 10, y: 375, width: 360, height: 185 }
    }
  ],
  non_table_objects: [
    {
      id: 'obj_mushola',
      type: 'zone',
      label: 'Mushola',
      shape: 'polygon',
      points: [
        { x: 50, y: 16 },
        { x: 138, y: 16 },
        { x: 138, y: 134 },
        { x: 198, y: 134 },
        { x: 198, y: 160 },
        { x: 50, y: 160 }
      ],
      x: 50,
      y: 16,
      width: 148,
      height: 144,
      background_color: '#d6d8db',
      text_color: '#374151'
    }
  ],
  tables: [
    // --- Indoor Section ---
    // Row 1 (Top beside Mushola)
    {
      table_number: '15',
      label: 'meja 15',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 148,
      y: 16,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '14',
      label: 'meja 14',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 16,
      width: 86,
      height: 68,
      initial_state: 'available'
    },

    // Row 2 (Beside Mushola L-bottom)
    {
      table_number: '13',
      label: 'meja 13',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 92,
      width: 86,
      height: 68,
      initial_state: 'available'
    },

    // Row 3 (Full 3-column row below Mushola)
    {
      table_number: '10',
      label: 'meja 10',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 52,
      y: 180,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '11',
      label: 'meja 11',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 148,
      y: 180,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '12',
      label: 'meja 12',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 180,
      width: 86,
      height: 68,
      initial_state: 'available'
    },

    // Row 4 (Bottom indoor row)
    {
      table_number: '9',
      label: 'meja 9',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 52,
      y: 258,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '8',
      label: 'meja 8',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 148,
      y: 258,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '7',
      label: 'meja 7',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 258,
      width: 86,
      height: 68,
      initial_state: 'blocked' // Unavailable in reference image
    },

    // --- Outdoor / Smoking Section ---
    // Top Row of Smoking Section (y absolute 390 -> relY 15)
    {
      table_number: '2',
      label: 'meja 2',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 52,
      y: 390,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '3',
      label: 'meja 3',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 148,
      y: 390,
      width: 86,
      height: 68,
      initial_state: 'blocked' // Unavailable in reference image
    },
    {
      table_number: '6',
      label: 'meja 6',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 390,
      width: 86,
      height: 68,
      initial_state: 'available'
    },

    // Bottom Row of Smoking Section (y absolute 468 -> relY 93)
    {
      table_number: '1',
      label: 'meja 1',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 52,
      y: 468,
      width: 86,
      height: 68,
      initial_state: 'blocked' // Unavailable in reference image
    },
    {
      table_number: '4',
      label: 'meja 4',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 148,
      y: 468,
      width: 86,
      height: 68,
      initial_state: 'available'
    },
    {
      table_number: '5',
      label: 'meja 5',
      capacity: 8,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 244,
      y: 468,
      width: 86,
      height: 68,
      initial_state: 'available'
    }
  ]
};

module.exports = TEMPLATE_01;
