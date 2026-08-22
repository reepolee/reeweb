<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
	xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
	xmlns:xhtml="http://www.w3.org/1999/xhtml">

	<xsl:output method="html" encoding="UTF-8" indent="yes"/>

	<xsl:template match="/">
		<html lang="en">
			<head>
				<meta charset="UTF-8"/>
				<title>Sitemap</title>
				<style>
					* { box-sizing: border-box; }
					body {
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
						margin: 0;
						padding: 2rem;
						background: #f6f7f9;
						color: #1f2937;
					}
					.wrap { max-width: 1100px; margin: 0 auto; }
					h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
					.meta { color: #6b7280; font-size: .9rem; margin-bottom: 1.5rem; }
					table {
						width: 100%;
						border-collapse: collapse;
						background: #fff;
						border-radius: 8px;
						overflow: hidden;
						box-shadow: 0 1px 3px rgba(0,0,0,.06);
					}
					th, td {
						text-align: left;
						padding: .65rem .85rem;
						border-bottom: 1px solid #e5e7eb;
						font-size: .92rem;
					}
					th {
						background: #f3f4f6;
						font-weight: 600;
						color: #374151;
					}
					tr:last-child td { border-bottom: none; }
					tr:hover td { background: #fafbfc; }
					a { color: #2563eb; text-decoration: none; }
					a:hover { text-decoration: underline; }
					.lang-list { color: #6b7280; font-size: .85rem; }
					.lang-list code {
						font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
						background: #eef2ff;
						color: #4338ca;
						padding: 1px 6px;
						border-radius: 4px;
						margin-right: 4px;
						font-size: .8rem;
					}
				</style>
			</head>
			<body>
				<div class="wrap">
					<h1>Sitemap</h1>
					<p class="meta">
						<xsl:value-of select="count(sm:urlset/sm:url)"/> URL(s)
					</p>
					<table>
						<thead>
							<tr>
								<th>URL</th>
								<th>Last modified</th>
								<th>Language</th>
							</tr>
						</thead>
						<tbody>
							<xsl:for-each select="sm:urlset/sm:url">
								<tr>
									<td>
										<a>
											<xsl:attribute name="href"><xsl:value-of select="sm:loc"/></xsl:attribute>
											<xsl:value-of select="sm:loc"/>
										</a>
									</td>
									<td>
										<xsl:value-of select="sm:lastmod"/>
									</td>
									<td class="lang-list">
										<xsl:variable name="this_loc" select="sm:loc"/>
										<xsl:for-each select="xhtml:link[@rel='alternate' and @href=$this_loc]">
											<code><xsl:value-of select="@hreflang"/></code>
											<xsl:if test="position() != last()"><xsl:text> </xsl:text></xsl:if>
										</xsl:for-each>
									</td>
								</tr>
							</xsl:for-each>
						</tbody>
					</table>
				</div>
			</body>
		</html>
	</xsl:template>

</xsl:stylesheet>
