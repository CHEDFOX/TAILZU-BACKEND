-- Postal keeps one database per mail server, named postal-<id>, and creates them
-- itself. The image's own user only gets the main database; this adds the rest.
-- Runs once, when the data volume is first created.
GRANT ALL PRIVILEGES ON `postal`.* TO 'postal'@'%';
GRANT ALL PRIVILEGES ON `postal-%`.* TO 'postal'@'%';
FLUSH PRIVILEGES;
