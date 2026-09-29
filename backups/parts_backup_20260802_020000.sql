-- PostgreSQL 数据库备份 (via SQLAlchemy)
-- 时间: 2026-08-02T02:00:07.469656

-- 表: repositories
INSERT INTO repositories (id, name) VALUES ('3', '新仓库2');
INSERT INTO repositories (id, name) VALUES ('4', '新仓库3');
INSERT INTO repositories (id, name) VALUES ('0', '临时仓库');
INSERT INTO repositories (id, name) VALUES ('1', '新仓库');
INSERT INTO repositories (id, name) VALUES ('2', '新仓库1');

-- 表: boxes
INSERT INTO boxes (id, box_number, name, repository_id) VALUES ('88', '2', 'A2', '1');
INSERT INTO boxes (id, box_number, name, repository_id) VALUES ('87', '1', 'A1', '1');
INSERT INTO boxes (id, box_number, name, repository_id) VALUES ('89', '3', '新盒子', '1');
INSERT INTO boxes (id, box_number, name, repository_id) VALUES ('86', '1', '临时盒子', '0');

-- 表: parts
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('26', '3001', 'Brick 2 x 4', '484', 'True', '40', '87');
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('21', '3002', 'Brick 2 x 3', '25', 'True', '81', '87');
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('25', '3001', 'Brick 2 x 4', '27', 'True', '60', '87');
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('22', '3001', 'Brick 2 x 4', '4', 'True', '55', '87');
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('24', '3001', 'Brick 2 x 4', '1', 'False', '8', '88');
INSERT INTO parts (id, part_num, name, color_id, is_new, quantity, box_id) VALUES ('1', '3002', 'Brick 2 x 3', '4', 'True', '31', '88');

-- 表: colors
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('1', '红色', '#C91A09', '21');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('2', '蓝色', '#0055BF', '23');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('3', '绿色', '#237841', '24');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('4', '黄色', '#F2CD37', '2');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('5', '白色', '#FFFFFF', '1');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('6', '黑色', '#05131D', '11');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('7', '灰色', '#959A9B', '199');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('8', '深灰色', '#6C6E68', '199');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('9', '棕色', '#583927', '88');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('10', '粉色', '#F6A7B0', '25');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('11', '橙色', '#E07A2C', '4');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('12', '紫色', '#6B3F87', '26');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('13', '青色', '#0E7C9E', '28');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('14', '金色', '#D4B16A', '212');
INSERT INTO colors (id, color_name, rgb, bricklink_id) VALUES ('15', '银色', '#A0A5A9', '199');

