# Stejné prostředí jako WEDOS (PHP + Apache + MySQL ovladač), shodné s hubnutím.
FROM php:8.2-apache
RUN docker-php-ext-install mysqli pdo pdo_mysql && a2enmod rewrite headers
WORKDIR /var/www/html
